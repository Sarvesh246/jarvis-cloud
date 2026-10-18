import test from 'node:test';
import assert from 'node:assert/strict';
import { differenceCells } from '../src/lib/table.js';

test('side-by-side comparison highlights differing values, preserves matching values and skips labels', () => {
 const rows = [['Storage','256 GB','512 GB'],['Port','USB-C',' usb-c '],['Price','$10','$12']];
 assert.deepEqual([...differenceCells(rows,['Feature','A','B'],[0,1,2])],['0:1','0:2','2:1','2:2']);
});
test('selected rows compare matching columns even after sorting or filtering', () => {
 const rows = [['A','16 GB','256 GB'],['B','16 GB','512 GB'],['C','32 GB','512 GB']];
 assert.deepEqual([...differenceCells(rows,['Name','RAM','Storage'],[1,0,2],[0,1])],['1:2','0:2']);
 assert.deepEqual([...differenceCells(rows,['Name','RAM','Storage'],[2,0],[0,2])],['2:1','0:1','2:2','0:2']);
});
test('two-row key-value comparisons work and a single value never differs from itself', () => {
 assert.deepEqual([...differenceCells([['A','Yes'],['B','No']],['Name','Value'],[0,1])],['0:1','1:1']);
 assert.equal(differenceCells([['A','Yes']],['Name','Value'],[0]).size,0);
});
