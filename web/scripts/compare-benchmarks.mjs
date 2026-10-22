import {readFile,writeFile} from 'node:fs/promises';
import {compareReports} from '../evaluation/compare.js';

const [beforePath,afterPath,out]=process.argv.slice(2);
if(!beforePath||!afterPath||!out) throw Error('Usage: compare-benchmarks.mjs before.json after.json output.json');
const read=async path=> {
  const text=await readFile(path,'utf8');
  if(text.length>20_000_000) throw Error('Benchmark report exceeds its limit.');
  const data=JSON.parse(text);
  if(!Array.isArray(data.rows)||data.rows.length>10000) throw Error('Invalid benchmark rows.');
  return data;
};
const result=compareReports(await read(beforePath),await read(afterPath));
await writeFile(out,JSON.stringify(result,null,2)+'\n');
console.info(JSON.stringify(result));
if(!result.eligible) process.exitCode=1;
