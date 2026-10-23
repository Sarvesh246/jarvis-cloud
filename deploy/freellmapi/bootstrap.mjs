import { gunzipSync } from 'node:zlib';

export function cloudSeed(env) {
  if (!/^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY || ''))
    throw new Error('Set a separate 64-character ENCRYPTION_KEY for the cloud router.');
  if (!/^[a-zA-Z0-9_-]{32,}$/.test(env.FREELLMAPI_API_KEY || ''))
    throw new Error('Set a separate FREELLMAPI_API_KEY for the cloud router.');
  let config;
  try {
    const encoded = env.FREELLMAPI_CONFIG_B64 || '';
    const bytes = Buffer.from(encoded.startsWith('gzip:') ? encoded.slice(5) : encoded, 'base64');
    config = JSON.parse((encoded.startsWith('gzip:') ? gunzipSync(bytes, {maxOutputLength:1024*1024}) : bytes).toString('utf8'));
  }
  catch { throw new Error('The cloud provider configuration could not be read.'); }
  if (!config?.admin?.email || typeof config.admin.password !== 'string' || config.admin.password.length < 16)
    throw new Error('The cloud configuration needs a dashboard account before the server starts.');
  if (!Array.isArray(config.keys) || !config.keys.length)
    throw new Error('The cloud configuration needs provider keys.');
  if (config.customProviders?.length || config.keys.some(key => key.platform === 'custom'))
    throw new Error('PC custom endpoints belong in the local router, not the cloud configuration.');
  return config;
}

export function selectCloudModels(db, contextTokens = 128000) {
  // The dedicated chain excludes small windows, non-tool models and unconfigured
  // providers. New catalog entries cannot silently widen this chain between boots.
  const apply = db.transaction(() => {
    let profile = db.prepare("SELECT id FROM profiles WHERE name = 'Vaelo cloud' LIMIT 1").get();
    if (!profile) {
      const row = db.prepare("INSERT INTO profiles (name, auto_include_new_models) VALUES ('Vaelo cloud', 0)").run();
      profile = { id: Number(row.lastInsertRowid) };
    }
    db.prepare('UPDATE profiles SET auto_include_new_models = 0 WHERE id = ?').run(profile.id);
    const models = db.prepare(`SELECT m.id FROM models m
      WHERE m.enabled = 1 AND m.supports_tools = 1 AND m.context_window >= ?
        AND m.platform != 'custom'
        AND COALESCE(m.paid_input_per_m, 0) = 0 AND COALESCE(m.paid_output_per_m, 0) = 0
        AND EXISTS (SELECT 1 FROM api_keys k WHERE k.platform = m.platform AND k.enabled = 1)
      ORDER BY m.intelligence_rank, m.id`).all(contextTokens);
    if (!models.length) throw new Error('No configured tool models meet the cloud context requirement.');
    db.prepare('DELETE FROM profile_models WHERE profile_id = ?').run(profile.id);
    const add = db.prepare('INSERT INTO profile_models (profile_id, model_db_id, priority, enabled) VALUES (?, ?, ?, 1)');
    models.forEach((model, index) => add.run(profile.id, model.id, index + 1));
    db.prepare("INSERT INTO settings (key, value) VALUES ('active_profile_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(profile.id));
    return models.length;
  });
  return apply();
}

// Serverless startup skips the desktop catalog scheduler. Install the supported
// free image routes explicitly so a fresh temporary database can draw immediately.
// Keep these separate from the chat profile and preserve an operator-disabled row.
export function seedCloudImages(db) {
  const routes = [
    ['cloudflare', '@cf/black-forest-labs/flux-1-schnell', 'FLUX.1 Schnell', 0],
    ['cloudflare', '@cf/black-forest-labs/flux-2-klein-4b', 'FLUX.2 Klein editing', 1],
  ];
  const insert = db.prepare(`INSERT OR IGNORE INTO media_models
    (platform, model_id, display_name, modality, priority, enabled, quota_label)
    SELECT ?, ?, ?, 'image', ?, 1, 'Provider free allowance'
    WHERE EXISTS (SELECT 1 FROM api_keys WHERE platform = ? AND enabled = 1)`);
  db.transaction(() => {
    for (const [platform, model, display, priority] of routes)
      insert.run(platform, model, display, priority, platform);
    db.prepare("UPDATE media_models SET meta_json = ? WHERE platform = 'cloudflare' AND model_id = '@cf/black-forest-labs/flux-2-klein-4b'").run(JSON.stringify({requestStyle:'multipart'}));
  })();
}
