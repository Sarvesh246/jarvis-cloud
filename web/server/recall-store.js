import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { plainContext, rankExcerpts, terms } from '../shared/context-retrieval.js';

const account = sub => createHash('sha256').update(sub).digest('hex');
let client, ready;
function database() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('Recall storage is unavailable.');
  client ??= neon(url);
  ready ??= client.query(`CREATE TABLE IF NOT EXISTS conversation_recall (
    account text NOT NULL, chat_id text NOT NULL, version text NOT NULL,
    title text NOT NULL, excerpts jsonb NOT NULL, document tsvector NOT NULL,
    updated bigint NOT NULL, PRIMARY KEY(account,chat_id))`).then(() =>
      client.query('CREATE INDEX IF NOT EXISTS conversation_recall_search ON conversation_recall USING gin(document)'))
    .catch(error => {ready=null;throw error;});
  return {sql:client, ready};
}

export function recallDocument(chat) {
  if (!Array.isArray(chat?.messages)) return [];
  const output = []; let room = 100000;
  // Exclude hidden/generated notes, tools, files and incomplete assistant drafts.
  for (let i=chat.messages.length-1;i>=0 && output.length<160 && room>0;i--) {
    const message=chat.messages[i];
    if (!['user','assistant'].includes(message?.role) || message.running || message.failed) continue;
    const text=plainContext(message.text || message.content).replace(/\[\[remember:[^\]]*\]\]/gi,'').slice(0,6000);
    if (!text.trim()) continue;
    for(let at=0;at<text.length && room>0 && output.length<160;at+=700) {
      const quote=text.slice(at,at+900).slice(0,room); room-=quote.length;
      output.push({text:quote,role:message.role,turn:i+1});
    }
  }
  return output;
}

export async function indexConversation(sub, id, entry, chat) {
  const {sql,ready}=database(); await ready;
  const owner=account(sub), path=`chats/${owner}/index.json`;
  if(entry.deleted) {
    // Even if a later edit races cleanup, retrieval validates manifest versions.
    await sql.query(`DELETE FROM conversation_recall WHERE account=$1 AND chat_id=$2 AND EXISTS
      (SELECT 1 FROM kv_store k WHERE k.path=$4 AND k.body::jsonb->'entries'->$2->>'version'=$3
      AND (k.body::jsonb->'entries'->$2->>'deleted')::boolean=true)`,[owner,id,entry.version,path]);
    return;
  }
  const excerpts=recallDocument(chat), title=String(chat?.title || 'Earlier conversation').slice(0,160);
  const document=[title,...excerpts.map(item=>item.text)].join('\n');
  await sql.query(`INSERT INTO conversation_recall(account,chat_id,version,title,excerpts,document,updated)
    SELECT $1,$2,$3,$4,$5::jsonb,to_tsvector('english',$6),$7 FROM kv_store k
      JOIN kv_store m ON m.path=$9 AND (m.body::jsonb->>'enabled')::boolean=true AND (m.body::jsonb->>'recallEnabled')::boolean=true WHERE k.path=$8
      AND k.body::jsonb->'entries'->$2->>'version'=$3 AND COALESCE((k.body::jsonb->'entries'->$2->>'deleted')::boolean,false)=false
    ON CONFLICT(account,chat_id) DO UPDATE SET version=EXCLUDED.version,title=EXCLUDED.title,
      excerpts=EXCLUDED.excerpts,document=EXCLUDED.document,updated=EXCLUDED.updated`,
    [owner,id,entry.version,title,JSON.stringify(excerpts),document,entry.updated,path,`memory/${owner}.json`]);
}

export function suppresses(text, forgotten=[]) {
  const words=new Set(terms(text));
  return forgotten.some(note => {
    const keys=terms(note).filter(word=>!['prefer','like','likes','want','user','person','reply'].includes(word));
    return keys.length && keys.filter(word=>words.has(word)).length >= Math.min(2,keys.length);
  });
}

export async function searchConversations(sub, query, {exclude, forgotten=[], signal}={}) {
  const words=terms(query); if(!words.length) return [];
  const {sql,ready}=database(); await ready;
  const owner=account(sub);
  const rows=await sql.query(`SELECT c.chat_id,c.version,c.title,c.excerpts,c.updated,m.body::jsonb->'forgotten' AS forgotten FROM conversation_recall c
    JOIN kv_store k ON k.path=$2 JOIN kv_store m ON m.path=$5
    WHERE c.account=$1 AND c.chat_id <> $4 AND (m.body::jsonb->>'enabled')::boolean=true AND (m.body::jsonb->>'recallEnabled')::boolean=true
      AND k.body::jsonb->'entries'->c.chat_id->>'version'=c.version
      AND COALESCE((k.body::jsonb->'entries'->c.chat_id->>'deleted')::boolean,false)=false
      AND c.document @@ to_tsquery('english',$3)
    ORDER BY ts_rank_cd(c.document,to_tsquery('english',$3)) DESC,c.updated DESC LIMIT 6`,
    [owner,`chats/${owner}/index.json`,words.map(word=>`'${word.replace(/'/g,"''")}'`).join(' | '),exclude || '',`memory/${owner}.json`],
    {fetchOptions:{signal:signal || AbortSignal.timeout(1200)}});
  const candidates=rows.flatMap(row => (Array.isArray(row.excerpts)?row.excerpts:[])
    .filter(item=>typeof item.text==='string' && !suppresses(item.text,[...forgotten,...(Array.isArray(row.forgotten)?row.forgotten:[])]))
    .map(item=>({...item,chat:row.chat_id,title:row.title,updated:Number(row.updated)})));
  return rankExcerpts(candidates,query,{limit:4,budget:3200});
}
