import { readdir, readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
const url=process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) throw new Error("Set MIGRATION_DATABASE_URL for the intended deployment database.");
const sql=neon(url);
await sql.query("CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
for(const name of (await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort()) {
  const found=await sql.query("SELECT version FROM schema_migrations WHERE version=$1",[name]);
  if(found.length) continue;
  const statements=(await readFile(`migrations/${name}`,'utf8')).split(';').map(value=>value.trim()).filter(Boolean);
  await sql.transaction([...statements.map(statement=>sql.query(statement)),sql.query("INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING",[name])]);
  console.log(`Applied ${name}`);
}
