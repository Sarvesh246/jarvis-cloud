const MAX_BYTES = 25 * 1024 * 1024;
const EXT = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif','image/svg+xml':'svg'};

export async function imageDownload(src, {request = fetch, maxBytes = MAX_BYTES} = {}) {
  const url = new URL(src);
  if (url.username || url.password || !(url.protocol === 'https:' || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(src))) throw new Error('Unsupported image address.');
  const response = await request(url.href,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || !EXT[mime] || Number(response.headers.get('content-length')) > maxBytes || !response.body) {await response.body?.cancel();throw new Error('The image could not be saved.');}
  const reader=response.body.getReader(), chunks=[];
  let size=0;
  try {
    while (true) {
      const {value,done}=await reader.read(); if (done) break;
      size+=value.byteLength;
      if (size>maxBytes) {await reader.cancel();throw new Error('The image is too large to save here.');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  if (!size) throw new Error('The image was empty.');
  const bytes=new Uint8Array(size); let offset=0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {bytes,mime,name:`vaelo-image.${EXT[mime]}`};
}
