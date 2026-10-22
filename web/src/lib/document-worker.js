import { extractOffice } from './office-reader.js';
self.onmessage = ({data}) => {
  try { self.postMessage({ok:true,...extractOffice(new Uint8Array(data.buffer),data.extension)}); }
  catch(error) { self.postMessage({ok:false,error:error.message}); }
};
