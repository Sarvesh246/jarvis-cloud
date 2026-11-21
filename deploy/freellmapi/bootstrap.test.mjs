import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { cloudSeed, selectCloudModels, seedCloudImages } from './bootstrap.mjs';

test('startup requires separate credentials and a protected dashboard', () => {
  const config = {admin:{email:'owner@example.com',password:'a'.repeat(32)},keys:[{platform:'nvidia',key:'example'}]};
  const env = {ENCRYPTION_KEY:'a'.repeat(64),FREELLMAPI_API_KEY:'b'.repeat(48),FREELLMAPI_CONFIG_B64:Buffer.from(JSON.stringify(config)).toString('base64')};
  assert.deepEqual(cloudSeed(env), config);
  assert.deepEqual(cloudSeed({...env,FREELLMAPI_CONFIG_B64:'gzip:'+gzipSync(JSON.stringify(config)).toString('base64')}),config);
  assert.throws(() => cloudSeed({...env, ENCRYPTION_KEY:''}));
  assert.throws(() => cloudSeed({...env, FREELLMAPI_API_KEY:''}));
  assert.throws(() => cloudSeed({...env, FREELLMAPI_CONFIG_B64:Buffer.from(JSON.stringify({...config,admin:null})).toString('base64')}));
  assert.throws(() => cloudSeed({...env, FREELLMAPI_CONFIG_B64:Buffer.from(JSON.stringify({...config,keys:[{platform:'custom',baseUrl:'http://127.0.0.1:11434'}]})).toString('base64')}));
});

test('the cloud chain selects supported models and stays stable across restarts', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT, auto_include_new_models INTEGER);
    CREATE TABLE models (id INTEGER PRIMARY KEY, platform TEXT, enabled INTEGER, supports_tools INTEGER, context_window INTEGER, intelligence_rank INTEGER, paid_input_per_m REAL DEFAULT 0, paid_output_per_m REAL DEFAULT 0, model_id TEXT DEFAULT 'model');
    CREATE TABLE api_keys (platform TEXT, enabled INTEGER);
    CREATE TABLE profile_models (profile_id INTEGER, model_db_id INTEGER, priority INTEGER, enabled INTEGER);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO api_keys VALUES ('nvidia',1),('google',0),('custom',1);
    INSERT INTO models (id,platform,enabled,supports_tools,context_window,intelligence_rank) VALUES (1,'nvidia',1,1,128000,1),(2,'nvidia',1,1,64000,2),
      (3,'nvidia',1,0,200000,3),(4,'nvidia',1,1,NULL,4),(5,'google',1,1,1000000,1),
      (6,'custom',1,1,128000,1),(7,'nvidia',0,1,128000,5);
    INSERT INTO models VALUES (8,'nvidia',1,1,1000000,1,1,0,'paid');`);
  const wrapped = {prepare:sql=>db.prepare(sql),transaction:fn=>()=>{
    db.exec('BEGIN'); try {const result=fn();db.exec('COMMIT');return result;} catch(error){db.exec('ROLLBACK');throw error;}
  }};
  assert.equal(selectCloudModels(wrapped),1);
  assert.equal(selectCloudModels(wrapped),1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM profiles').get().count,1);
  assert.deepEqual(db.prepare('SELECT model_db_id FROM profile_models').all().map(r=>r.model_db_id),[1]);
  assert.equal(db.prepare('SELECT auto_include_new_models FROM profiles').get().auto_include_new_models,0);
  db.exec('UPDATE models SET enabled=0');
  assert.throws(()=>selectCloudModels(wrapped),/No configured/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM profile_models').get().count,1,'a failed update retains the working chain');
  db.close();
});

test('retired routes and single-purpose models stay out of the chat chain', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT, auto_include_new_models INTEGER);
    CREATE TABLE models (id INTEGER PRIMARY KEY, platform TEXT, model_id TEXT, enabled INTEGER, supports_tools INTEGER, context_window INTEGER, intelligence_rank INTEGER, paid_input_per_m REAL DEFAULT 0, paid_output_per_m REAL DEFAULT 0);
    CREATE TABLE api_keys (platform TEXT, enabled INTEGER);
    CREATE TABLE profile_models (profile_id INTEGER, model_db_id INTEGER, priority INTEGER, enabled INTEGER);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO api_keys VALUES ('nvidia',1),('openrouter',1),('kilo',1),('ovh',1),('cohere',1);
    INSERT INTO models (id,platform,model_id,enabled,supports_tools,context_window,intelligence_rank) VALUES
      (1,'nvidia','openai/gpt-oss-20b',1,1,128000,1),
      (2,'openrouter','nvidia/nemotron-nano-12b-v2-vl:free',1,1,128000,1),
      (3,'kilo','cohere/north-mini-code:free',1,1,128000,1),
      (4,'kilo','dots-studio/dots-3-note-preview:free',1,1,128000,1),
      (5,'ovh','Mistral-Small-3.2-24B-Instruct-2506',1,1,128000,1),
      (6,'cohere','command-r7b-arabic-02-2025',1,1,128000,1),
      (7,'cohere','command-a-translate-08-2025',1,1,128000,1),
      (8,'nvidia','nvidia/nemotron-3-ultra-550b-a55b',1,1,128000,2),
      (9,'ovh','gpt-oss-20b',1,1,128000,3),
      (10,'openrouter','openai/gpt-oss-20b:free',1,1,128000,4);`);
  const wrapped = {prepare:sql=>db.prepare(sql),transaction:fn=>()=>fn()};
  assert.equal(selectCloudModels(wrapped), 3);
  assert.deepEqual(db.prepare('SELECT model_db_id FROM profile_models ORDER BY priority').all().map(r=>r.model_db_id), [8, 9, 10],
    'the same model on a provider that still serves it is kept');
  db.close();
});

test('fresh cloud databases seed images separately and preserve disabled providers on restart', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE api_keys (platform TEXT, enabled INTEGER);
    CREATE TABLE media_models (platform TEXT, model_id TEXT, display_name TEXT, modality TEXT,
      priority INTEGER, enabled INTEGER, quota_label TEXT, meta_json TEXT, UNIQUE(platform, model_id));
    INSERT INTO api_keys VALUES ('cloudflare', 1), ('nvidia', 0);`);
  const wrapped = { prepare: sql => db.prepare(sql), transaction: fn => () => fn() };
  seedCloudImages(wrapped);
  assert.deepEqual(db.prepare('SELECT platform, modality, priority FROM media_models').all().map(r => ({...r})),
    [{ platform: 'cloudflare', modality: 'image', priority: 0 }, { platform: 'cloudflare', modality: 'image', priority: 1 }]);
  db.exec("UPDATE api_keys SET enabled = 1 WHERE platform = 'nvidia'");
  seedCloudImages(wrapped);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media_models').get().n, 2);
  db.exec("UPDATE media_models SET enabled = 0 WHERE platform = 'cloudflare'");
  seedCloudImages(wrapped);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media_models').get().n, 2);
  assert.equal(db.prepare("SELECT enabled FROM media_models WHERE platform = 'cloudflare'").get().enabled, 0);
  db.close();
});
