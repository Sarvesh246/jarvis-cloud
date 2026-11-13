import { readdir, readFile } from "node:fs/promises";
const names = new Map();
async function walk(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const file = `${path}/${item.name}`;
    if (item.isDirectory()) await walk(file);
    else if (file.endsWith('.css')) {
      const source = await readFile(file, 'utf8');
      for (const [, name] of source.matchAll(/@keyframes\s+([\w-]+)/g)) {
        if (names.has(name) && names.get(name) !== file) throw new Error(`Duplicate keyframes ${name}: ${names.get(name)} and ${file}`);
        names.set(name, file);
      }
    }
  }
}
await walk('src'); console.log(`Checked ${names.size} animation names.`);
