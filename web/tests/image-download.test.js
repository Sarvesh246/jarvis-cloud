import test from 'node:test';
import assert from 'node:assert/strict';
import {imageDownload} from '../src/lib/image-download.js';

test('image downloads preserve binary bytes and omit account credentials',async () => {
  let options;
  const file=await imageDownload('https://example.com/picture',{request:async (_,init)=>{options=init;return new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}});}});
  assert.deepEqual([...file.bytes],[137,80,78,71]); assert.equal(file.name,'vaelo-image.png');
  assert.equal(options.credentials,'omit'); assert.equal(options.referrerPolicy,'no-referrer');
});
test('invalid, non-image, empty and oversized image downloads fail without an artifact',async () => {
  for(const src of ['javascript:alert(1)','https://name:secret@example.com/image.png','http://example.com/image.png']) await assert.rejects(imageDownload(src,{request(){throw new Error('must not request');}}));
  for(const response of [new Response('<html>error</html>',{headers:{'content-type':'text/html'}}),new Response(null,{headers:{'content-type':'image/png'}}),new Response(new Uint8Array(5),{headers:{'content-type':'image/png'}})]) await assert.rejects(imageDownload('https://example.com/image.png',{maxBytes:4,request:async()=>response}));
});
