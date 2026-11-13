import { readFile, stat, writeFile } from "node:fs/promises";
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const entry = Object.values(manifest).find(item => item.isEntry);
const seen = new Set();
async function measure(item) {
  if (seen.has(item.file)) return 0;
  seen.add(item.file);
  let bytes = (await stat('dist/' + item.file)).size;
  for (const name of item.imports || []) bytes += await measure(manifest[name]);
  return bytes;
}
const bytes = await measure(entry);
const report = { initialJavaScriptBytes: bytes, budgetBytes: 400000, files: [...seen], chunks: Object.values(manifest).filter(item => item.file.endsWith('.js')).map(item => item.file) };
await writeFile('dist/bundle-report.json', JSON.stringify(report, null, 2));
console.log(`First-paint JavaScript: ${bytes} / ${report.budgetBytes} bytes.`);
if (bytes > report.budgetBytes) process.exitCode = 1;
