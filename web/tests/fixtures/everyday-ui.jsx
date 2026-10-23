// Synthetic interaction fixture; never calls a model or an account service.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader/opsz.css';
import '../../src/design/tokens.css';
import '../../src/design/base.css';
import '../../src/shell.css';
import '../../src/phone.css';
import { Composer } from '../../src/components/Composer.jsx';
import { Message } from '../../src/components/Message.jsx';
import { Rendered } from '../../src/components/blocks/Blocks.jsx';
import { Chart } from '../../src/components/blocks/Chart.jsx';
import { SourceRail } from '../../src/components/SourceRail.jsx';
import { Sheet } from '../../src/components/Sheet.jsx';
import { CapabilityBento, EmptyState, SkeletonCards, Segmented } from '../../src/components/EverydayUI.jsx';
import { readAttachment } from '../../src/lib/attachments.js';
import { DEFAULTS } from '../../src/lib/preferences.js';

const rich = data => '```vaelo-ui\n' + JSON.stringify(data) + '\n```';
const samples = [
  ['Summary', 'Here is the situation.\n\n- **Scope:** A small website\n- **Time:** Three weeks\n- **Team:** Two designers'],
  ['Question', 'Which approach do you prefer?\n- A small first release\n- The complete scope'],
  ['Artifact', '```html\n<style>body{font:20px Georgia;padding:24px;color:#3c3025}</style><h1>Your project</h1><p>A useful preview.</p>\n```'],
  ['Audio', '[Recording](https://example.com/recording.mp3)'],
  ['Timeline', '```timeline\n# Project\n2026-10-24: Research\n2026-10-27: Design\n2026-11-03: Build\n```'],
  ['Comparison', '| Option | Price | Storage |\n|---|---|---|\n| Basic | $10 | 10 GB |\n| Plus | $20 | 30 GB |\n| Team | $40 | 100 GB |'],
  ['Images', '![Before](https://example.com/before.jpg)\n\n![After](https://example.com/after.jpg)'],
  ['Image comparison', rich({type:'image-compare',before:{src:'https://example.com/before.jpg',alt:'Before'},after:{src:'https://example.com/after.jpg',alt:'After'}})],
  ['Code changes', rich({type:'code-compare',before:'const total = a + b;',after:'const total = Number(a) + Number(b);'})],
  ['Workflow', rich({type:'integrations',items:[{label:'Documents',value:'Supplied files',direction:'source'},{label:'Project notes',value:'Proposed destination',direction:'destination'}]})],
  ['Files', rich({type:'files',paths:['src/App.jsx','src/components/Card.jsx','tests/card.test.js','README.md']})],
];
function Fixture() {
  const [draft,setDraft] = useState(''), [attachments,setAttachments] = useState([]), [sheet,setSheet] = useState(false), [more,setMore] = useState(false), [segment,setSegment] = useState('preview'), [version,setVersion] = useState(1);
  const field = useRef(null);
  const phone = new URLSearchParams(location.search).has('phone');
  return <main style={{maxWidth:960,padding:'20px',margin:'auto'}}>
    <h1>Everyday UI</h1><CapabilityBento onPick={setDraft}/>
    <section id="composer-fixture"><h2>Composer</h2><Composer ref={field} draft={draft} onChange={setDraft} onSend={() => setDraft('Sent')} onStop={() => {}} attachments={attachments} length={draft.length+attachments.reduce((n,f)=>n+(f.chars||0),0)} options={DEFAULTS} onOptions={() => {}} onFiles={async files => { const read = await Promise.all(files.map(readAttachment)); setAttachments(a => [...a,...read]); }} onRemoveFile={id=>setAttachments(a=>a.filter(f=>f.id!==id))} onUpdateFile={(id,body)=>setAttachments(a=>a.map(f=>f.id===id?{...f,body,chars:body.length}:f))} conversationId="fixture" guest /></section>
    <section id="source-fixture"><h2>Sources</h2><SourceRail sources={[{id:'source',index:1,title:'Documentation',domain:'example.com',url:'https://example.com/reference',kind:'reference',context:'The sentence in this answer that refers to this source.'}]} focus="source" /></section>
    <section><h2>Controls</h2><Segmented label="Artifact view" value={segment} options={[["preview","Preview"],["code","Code"],["split","Split"]]} onChange={setSegment}/><p role="status">Selected {segment}</p><button onClick={()=>setSheet(true)}>Open mobile sheet</button><Sheet open={sheet} onClose={()=>setSheet(false)} label="Fixture sheet"><h2>Sheet options</h2><button onClick={()=>setMore(v=>!v)}>Toggle more details</button>{more && <p>{'Details that grow the sheet. '.repeat(30)}</p>}<button onClick={()=>setSheet(false)}>Close sheet</button></Sheet></section>
    <section><h2>Loading and empty states</h2><SkeletonCards/><EmptyState title="Nothing saved yet" action="Start a message" onAction={()=>field.current?.focus()}>Your documents will gather here.</EmptyState></section>
    <section id="chart-fixture"><h2>Charts</h2><Chart columns={['Month','Visits']} rows={['Jan','Feb','Mar','Apr'].map((month,i)=>[month,String([20,40,0,65][i])])} plan={{label:0,values:[1]}} /></section>
    <section id="versions-fixture"><h2>Version history and usage</h2><Message message={{id:'versioned',role:'assistant',content:version?'Second version':'First version',version,versions:[{content:'First version'},{content:'Second version'}],context:{turns:8,dropped:2,files:['notes.md']},usage:{prompt_tokens:420,completion_tokens:80},activity:[{id:'step',tool:'web_search',done:true,startedAt:1,endedAt:2001,label:'Searched project documentation'}]}} phone={phone} isLast onAction={(type,id,index)=>{if(type==='version')setVersion(index)}} /></section>
    {samples.map(([name,content],i)=><section className="fixture-sample" key={name}><h2>{name}</h2><div className="prose"><Rendered content={content} stateKey={`sample-${i}`} onOpen={()=>{}} onAnswer={setDraft}/></div></section>)}
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
