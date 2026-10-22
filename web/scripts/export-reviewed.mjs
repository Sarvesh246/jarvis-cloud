import {readFile,writeFile} from 'node:fs/promises';
import {reviewedExamples} from '../evaluation/training-data.js';
import {comprehensiveCases} from '../evaluation/comprehensive.js';
const [input,out]=process.argv.slice(2);
if(!input||!out) throw Error('Usage: export-reviewed.mjs reviewed-report.json output.jsonl');
const raw=await readFile(input,'utf8');
if(raw.length>20_000_000) throw Error('Report exceeds its limit.');
const report=JSON.parse(raw);
if(!['smoke','comprehensive'].includes(report.suite||'smoke'))
  throw Error('Only text smoke/comprehensive suites qualify for this text-only export.');
const cases=report.suite==='comprehensive'?comprehensiveCases(report.seed):
  JSON.parse(await readFile(new URL('../evaluation/cases.json',import.meta.url),'utf8'));
const {examples,skipped}=reviewedExamples(report,cases);
if(!examples.length) throw Error('No complete, reviewed and hash-matched synthetic examples qualify.');
await writeFile(out,examples.map(value=>JSON.stringify(value)).join('\n')+'\n',{flag:'wx'});
console.info(JSON.stringify({exported:examples.length,skipped:skipped.length,training_submitted:false}));
