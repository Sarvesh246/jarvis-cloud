import test from 'node:test';
import assert from 'node:assert/strict';
import { patchImageReferences } from './image-reference-patch.mjs';

test('pinned patch wires validation, pixel forwarding and editing-only provider routing', () => {
  const proxy = "const ImageBody = z.object({\n prompt: parsed.data.prompt, n: parsed.data.n, size: parsed.data.size,";
  const media = "export interface ImageParams { prompt: string; n?: number; size?: string }\n        form.append('height', String(h));\n  const chain = resolveMediaChain(model, 'image');";
  const patched = patchImageReferences(proxy, media);
  assert.match(patched.proxy, /max\(4\)/);
  assert.match(patched.proxy, /reference_images: parsed.data.reference_images/);
  assert.match(patched.media, /input_image_/);
  assert.match(patched.media, /Buffer.from\(encoded, 'base64'\)/);
  assert.match(patched.media, /params.reference_images\?\.length/);
  assert.match(patched.media, /flux-2-klein-4b/);
  assert.deepEqual(patchImageReferences(patched.proxy, patched.media), patched);
  assert.throws(() => patchImageReferences('', ''), /contract changed/);
});
