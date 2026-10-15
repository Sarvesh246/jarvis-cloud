import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { cloudSeed, selectCloudModels } from './bootstrap.mjs';

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
    CREATE TABLE models (id INTEGER PRIMARY KEY, platform TEXT, enabled INTEGER, supports_tools INTEGER, context_window INTEGER, intelligence_rank INTEGER, paid_input_per_m REAL DEFAULT 0, paid_output_per_m REAL DEFAULT 0);
    CREATE TABLE api_keys (platform TEXT, enabled INTEGER);
    CREATE TABLE profile_models (profile_id INTEGER, model_db_id INTEGER, priority INTEGER, enabled INTEGER);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO api_keys VALUES ('nvidia',1),('google',0),('custom',1);
    INSERT INTO models (id,platform,enabled,supports_tools,context_window,intelligence_rank) VALUES (1,'nvidia',1,1,128000,1),(2,'nvidia',1,1,64000,2),
      (3,'nvidia',1,0,200000,3),(4,'nvidia',1,1,NULL,4),(5,'google',1,1,1000000,1),
      (6,'custom',1,1,128000,1),(7,'nvidia',0,1,128000,5);
    INSERT INTO models VALUES (8,'nvidia',1,1,1000000,1,1,0);`);
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
