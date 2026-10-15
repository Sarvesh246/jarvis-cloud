import test from 'node:test';
import assert from 'node:assert/strict';
import { resultOverview } from '../src/lib/workroom-view.js';

test('unknown results stay neutral and a blocked check takes priority over a passing check', () => {
  assert.equal(resultOverview({status:'computed',result:{}}).title, 'Your results are ready');
  assert.equal(resultOverview({result:{canProceed:false,canCutover:true}}).title, 'Fix these issues before moving on');
  assert.equal(resultOverview({status:'computed',result:{status:'failed'}}).title, 'The result did not pass your checks');
});

test('result overview keeps failed and missing checks visible without opening the full result', () => {
  const overview=resultOverview({result:{status:'partial',counts:{passed:2,failed:1,unverified:3}}});
  assert.equal(overview.title, 'Some parts still need attention');
  assert.deepEqual(overview.facts, ['2 checks passed','1 checks did not pass','3 checks need more information']);
});
