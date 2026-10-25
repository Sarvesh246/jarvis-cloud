import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerUrl;

export async function extractPdf(buffer) {
  const loading=getDocument({data:new Uint8Array(buffer),isEvalSupported:false,
    useSystemFonts:false,disableFontFace:true,stopAtErrors:true,maxImageSize:0});
  let expired=false, destruction, timeout;
  const timeoutError=Error('Reading this PDF took too long. Try a smaller file.');
  // PDF.js destruction can itself fail or wait on worker setup. Observe it
  // once without letting cleanup replace the source error or escape the deadline.
  const destroy=()=>destruction ??= Promise.resolve().then(()=>loading.destroy()).catch(()=>{});
  const checkDeadline=()=>{if(expired) throw timeoutError;};
  const deadline=new Promise((_,reject)=>{
    timeout=setTimeout(()=>{expired=true;reject(timeoutError);void destroy();},15000);
  });
  const read=async()=>{
    try {
      const pdf=await loading.promise;
      checkDeadline();
      if (pdf.numPages>200) throw Error('This PDF has more than 200 pages. Split it into smaller files.');
      const pages=[];
      let characters=0, readable=false;
      for(let number=1;number<=pdf.numPages;number++) {
        const page=await pdf.getPage(number);
        try {
          checkDeadline();
          const content=await page.getTextContent();
          checkDeadline();
          let body='', previousY=null;
          for(const item of content.items) {
            if(typeof item.str!=='string') continue;
            const y=item.transform?.[5];
            if(previousY!==null && y!==previousY && Math.abs(y-previousY)>3) body+='\n';
            body+=item.str+(item.hasEOL?'\n':' ');
            previousY=y;
            if(characters+body.length>158000) throw Error('Too much PDF text for one message. Split it into smaller files.');
          }
          readable ||= Boolean(body.trim());
          pages.push(`[Page ${number}]\n${body.trim()||'[No extractable text on this page; scanned or visual content is unavailable.]'}`);
          characters+=body.length;
        } finally {
          try {page.cleanup();} catch { /* worker destruction still releases the document */ }
        }
      }
      if(!readable) throw Error('This PDF has no extractable text. Upload clear page images for scanned or handwritten content.');
      return {body:'[PDF text extraction only. Images, charts and handwriting are not included.]\n'+pages.join('\n\n'),
        note:'PDF text extracted locally with page references. Visual content is not included.'};
    } finally {
      await destroy();
    }
  };
  try {return await Promise.race([read(),deadline]);}
  finally {clearTimeout(timeout);}
}
