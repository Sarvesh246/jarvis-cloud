import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/lib/attachments.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('async function scaled('), source.indexOf('export async function readAttachment(')).replace('export async function readImage', 'async function readImage');
function fixture({ fail = '', lengths = [20, 20], missingContext = false } = {}) {
  const bitmaps = [], canvases = [], encodes = [];
  const readImage = runInNewContext(`${functions}\nreadImage`, {
    crypto: { randomUUID: () => 'image-id' }, IMAGE_SIDE: 1600, IMAGE_CHARS: 650000,
    async createImageBitmap() {
      if (fail === 'decode') throw new Error('Bad image');
      const bitmap = {width:3200,height:1600,closed:0,close(){this.closed++;}};
      bitmaps.push(bitmap); return bitmap;
    },
    document: { createElement() {
      if (fail === 'canvas') throw new Error('Canvas unavailable');
      const canvas = {getContext() {
        if (missingContext) return null;
        return {fillRect(){},drawImage(){if (fail === 'draw') throw new Error('Canvas allocation failed');}};
      }, toDataURL(type,quality) {
        encodes.push({width:canvas.width,height:canvas.height,type,quality});
        if (fail === 'encode') throw new Error('Encode failed');
        return 'x'.repeat(lengths.shift() ?? 20);
      }};
      canvases.push(canvas); return canvas;
    }},
  });
  return {read:()=>readImage({name:'photo.png',size:1234}),bitmaps,canvases,encodes};
}

test('failed image preparation always releases every decoded bitmap', async () => {
  for (const fail of ['canvas','draw','encode']) {
    const f = fixture({fail}); const result = await f.read();
    assert.equal(result.state, 'unsupported', fail);
    assert.equal(f.bitmaps.length, 1, fail);
    assert.equal(f.bitmaps[0].closed, 1, fail);
    assert.ok(!('data' in result), fail);
  }
  const f = fixture({missingContext:true});
  assert.equal((await f.read()).state, 'unsupported');
  assert.equal(f.bitmaps[0].closed, 1);
});

test('normal resizing and detail retries keep dimensions, payload limits and metadata', async () => {
  const f = fixture({lengths:[650001,650001,650000,30]});
  const result = await f.read();
  assert.equal(result.state, 'ready'); assert.equal(result.data.length, 650000);
  assert.equal(result.thumb.length, 30); assert.equal(result.id, 'image-id');
  assert.equal(result.name, 'photo.png'); assert.equal(result.size, 1234); assert.equal(result.kind, 'image');
  assert.deepEqual(f.encodes, [
    {width:1600,height:800,type:'image/jpeg',quality:0.86},
    {width:1200,height:600,type:'image/jpeg',quality:0.75},
    {width:1000,height:500,type:'image/jpeg',quality:0.65},
    {width:160,height:80,type:'image/jpeg',quality:0.7},
  ]);
  assert.ok(f.bitmaps.every(bitmap => bitmap.closed === 1));
});

test('oversized and undecodable images fail without a thumbnail or retained bitmap', async () => {
  const f = fixture({lengths:[650001,650001,650001]});
  const result = await f.read(); assert.equal(result.state, 'too-large');
  assert.equal(f.bitmaps.length, 3); assert.ok(f.bitmaps.every(bitmap => bitmap.closed === 1));
  assert.ok(!('data' in result)); assert.ok(!('thumb' in result));
  const broken = fixture({fail:'decode'}); assert.equal((await broken.read()).state, 'unsupported');
  assert.equal(broken.bitmaps.length, 0);
});
