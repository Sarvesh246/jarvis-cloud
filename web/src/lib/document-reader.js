export const DOCUMENT_EXT=/\.(?:pdf|docx|xlsx|pptx)$/i;
export const DOCUMENT_LIMIT=8_000_000;
export async function readDocument(file) {
  if(file.size>DOCUMENT_LIMIT) throw Error('This document exceeds the 8 MB reading limit.');
  const buffer=await file.arrayBuffer();
  if(buffer.byteLength>DOCUMENT_LIMIT) throw Error('This document exceeds the 8 MB reading limit.');
  if(/\.pdf$/i.test(file.name)) return (await import('./pdf-reader.js')).extractPdf(buffer);
  return new Promise((resolve,reject)=> {
    const worker=new Worker(new URL('./document-worker.js',import.meta.url),{type:'module'});
    const finish=(error,result)=> {clearTimeout(timer);worker.terminate();error?reject(error):resolve(result);};
    const timer=setTimeout(()=>finish(Error('Reading this document took too long. Try a smaller file.')),15000);
    worker.onerror=()=>finish(Error('This document could not be read.'));
    worker.onmessage=({data})=>finish(data.ok?null:Error(data.error),data);
    worker.postMessage({buffer,extension:file.name.toLowerCase().split('.').at(-1)},[buffer]);
  });
}
