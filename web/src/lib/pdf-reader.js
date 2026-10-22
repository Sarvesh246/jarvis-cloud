import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerUrl;

export async function extractPdf(buffer) {
  const loading=getDocument({data:new Uint8Array(buffer),isEvalSupported:false,
    useSystemFonts:false,disableFontFace:true,stopAtErrors:true,maxImageSize:0});
  const timeout=setTimeout(()=>void loading.destroy(),15000);
  try {
    const pdf=await loading.promise;
    if (pdf.numPages>200) throw Error('This PDF has more than 200 pages. Split it into smaller files.');
    const pages=[];
    let characters=0, readable=false;
    for(let number=1;number<=pdf.numPages;number++) {
      const page=await pdf.getPage(number);
      const content=await page.getTextContent();
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
      page.cleanup();
    }
    if(!readable) throw Error('This PDF has no extractable text. Upload clear page images for scanned or handwritten content.');
    return {body:'[PDF text extraction only. Images, charts and handwriting are not included.]\n'+pages.join('\n\n'),
      note:'PDF text extracted locally with page references. Visual content is not included.'};
  } finally { clearTimeout(timeout); await loading.destroy(); }
}
