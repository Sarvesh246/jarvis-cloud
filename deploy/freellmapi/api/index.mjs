import { timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cloudSeed, selectCloudModels } from '../bootstrap.mjs';

async function initialize() {
  const config = cloudSeed(process.env);
  process.env.NODE_ENV = 'production';
  process.env.FREEAPI_DB_PATH = path.join(tmpdir(), 'vaelo-model-router.db');
  process.env.FREEAPI_CONFIG_JSON = JSON.stringify(config);
  process.env.FREEAPI_ENV_PATH = path.join(tmpdir(), 'unused-router.env');
  process.env.REQUEST_BODY_LIMIT_MB = '4';
  const { installLogRedaction } = await import('../vendor/server/dist/lib/log-redaction.js');
  installLogRedaction();
  const { installProcessSafetyNet } = await import('../vendor/server/dist/lib/process-safety-net.js');
  installProcessSafetyNet();
  const { initDb } = await import('../vendor/server/dist/db/index.js');
  const { applyDeclarativeConfigFromEnv } = await import('../vendor/server/dist/services/declarative-config.js');
  const { createApp } = await import('../vendor/server/dist/app.js');
  const { loadConfig } = await import('../vendor/server/dist/lib/config.js');
  const db = initDb();
  applyDeclarativeConfigFromEnv();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'unified_api_key'").run(process.env.FREELLMAPI_API_KEY);
  const models = selectCloudModels(db);
  const app = createApp({...loadConfig(), serveStaticAssets:false});
  return { app, models };
}

function authorized(req) {
  const expected = Buffer.from(`Bearer ${process.env.FREELLMAPI_API_KEY || ''}`);
  const actual = Buffer.from(req.headers.authorization || '');
  return Boolean(process.env.FREELLMAPI_API_KEY) && actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createHandler(initializeRouter = initialize) {
  let instance;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const route = new URL(req.url, 'https://router.invalid').pathname;
    // No dashboard, key export or administrative API is exposed by this function.
    if (!['/health', '/v1/models', '/v1/chat/completions', '/v1/images/generations'].includes(route)) {
      res.statusCode = 404; res.end(); return;
    }
    if (!authorized(req)) {
      res.statusCode = 401; res.end(JSON.stringify({error:'Authentication required.'})); return;
    }
    try {
      if (!instance) instance = initializeRouter().catch(error => {instance = undefined; throw error;});
      const { app, models } = await instance;
      if (route === '/health') {
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({status:'ok', models, context_floor:128000, host:'vercel'})); return;
      }
      return app(req, res);
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({error:'The model router is temporarily unavailable.'}));
    }
  };
}

export default createHandler();
