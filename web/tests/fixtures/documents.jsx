import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {readAttachment} from '../../src/lib/attachments.js';

function Documents() {
  const [result,setResult]=useState(null),[busy,setBusy]=useState(false);
  return <main><h1>Local document extraction</h1><p>Disposable synthetic files only. No network or model request is made.</p>
    <label>Choose document<input type="file" accept=".pdf,.docx,.xlsx,.pptx" onChange={async event=> {
      const file=event.target.files?.[0];if(!file)return;
      setBusy(true);setResult(null);
      try{setResult(await readAttachment(file));}finally{setBusy(false);}
    }}/></label>
    <p role="status">{busy?'Reading…':result?`${result.name}: ${result.state}`:'Choose a file.'}</p>
    {result&&<pre aria-label="Extracted document" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{result.note+'\n\n'+(result.body||'')}</pre>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Documents/>);
