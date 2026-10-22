import React, {useEffect,useRef,useState} from 'react';
import {useMemory} from '../lib/use-memory.js';
import './recall-settings.css';

export function RecallControls({memory,request}) {
  const [preparing,setPreparing]=useState(false), [message,setMessage]=useState('');
  const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function prepare() {
    setPreparing(true); setMessage('Preparing past conversations…');
    let after='',processed=0,skipped=0;
    try {
      for(let page=0;page<300 && active.current;page++) {
        const result=await request('/api/chats?resource=recall',{action:'prepare',after});
        processed+=result.processed; skipped+=result.skipped;
        if(!active.current) return;
        setMessage(`${processed} conversations prepared${skipped ? `; ${skipped} oversized conversations skipped` : ''}.`);
        if(result.done) return;
        if(result.after===after) throw new Error('Preparation paused. Try again.');
        after=result.after;
      }
      if(active.current) setMessage('Preparation paused. Run it again to check remaining conversations.');
    } catch(error) {if(active.current)setMessage(error.message || 'History could not be prepared.');}
    finally {if(active.current)setPreparing(false);}
  }
  if(!memory.data) return null;
  return <div className="recall-settings">
    <label className="sd-row"><span className="sd-row-text"><span className="sd-row-title">Use past conversations</span><span className="sd-row-help">Find relevant excerpts from your saved chats. Historical statements can be outdated; current corrections take precedence.</span></span>
      <input type="checkbox" aria-label="Use past conversations" checked={Boolean(memory.data.recallEnabled)} disabled={memory.busy || preparing || !memory.data.enabled} onChange={event=>memory.run({action:'recall',enabled:event.target.checked})}/></label>
    <p className="sd-note">Off until you choose it. Turning memory off also stops past-chat retrieval. Edited or deleted notes suppress matching older excerpts; deleted conversations are never recalled.</p>
    {memory.data.enabled && memory.data.recallEnabled && <button type="button" className="sd-button" disabled={preparing || memory.busy} onClick={prepare}>{preparing?'Preparing…':'Prepare past conversations'}</button>}
    <p className="sd-note" role="status">{message}</p>
  </div>;
}

export function PhoneMemory({request}) {
  const memory=useMemory(request);
  const [draft,setDraft]=useState(''),[editing,setEditing]=useState(null);
  return <section className="sp-group sp-memory"><h3 className="label">Memory</h3>
    {!memory.data ? <p className="sp-note">{memory.error || 'Loading memory…'}</p> : <>
      <label className="sp-row"><span>Use saved memory</span><input aria-label="Use saved memory" type="checkbox" checked={memory.data.enabled} disabled={memory.busy} onChange={event=>memory.run({action:'enable',enabled:event.target.checked})}/></label>
      <RecallControls memory={memory} request={request}/>
      <ul>{memory.data.items.map(item=><li key={item.id}>
        {editing?.id===item.id ? <form onSubmit={async event=>{event.preventDefault();if(await memory.run({action:'edit',id:item.id,text:editing.text}))setEditing(null);}}>
          <label>Edit note<input maxLength={280} value={editing.text} onChange={event=>setEditing({...editing,text:event.target.value})}/></label><button disabled={memory.busy}>Save</button><button type="button" onClick={()=>setEditing(null)}>Cancel</button>
        </form> : <><span>{item.text}</span><div><button type="button" disabled={memory.busy} onClick={()=>setEditing(item)}>Edit note</button><button type="button" disabled={memory.busy} onClick={()=>memory.run({action:'remove',id:item.id})}>Delete note</button></div></>}
      </li>)}</ul>
      <form onSubmit={async event=>{event.preventDefault();if(draft.trim() && await memory.run({action:'add',text:draft}))setDraft('');}}><label>Add a note<input maxLength={280} value={draft} onChange={event=>setDraft(event.target.value)}/></label><button disabled={memory.busy || !draft.trim()}>Add note</button></form>
    </>}
    {memory.problem && <p role="alert">{memory.problem}</p>}
  </section>;
}
