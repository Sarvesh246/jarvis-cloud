import { useEffect, useRef, useState } from 'react';
import { SLASH_COMMANDS, promptForCommand } from './slash-commands.js';
import { transcriptOf } from '../components/PhoneSheets.jsx';
import { download } from '../components/blocks/Blocks.jsx';
import { allowNotifications, copyText } from './desktop.js';

export function useSlashCommands({ session, request, chat, chats, setChats, setDraft, textarea, busy, online, options, setOptions,
  newChat, selectChat, renameChat, togglePin, stopReply, send, setSettingsOpen, setWorkroomOpen, setSaved, setPrefs, showToast, tellReady }) {
  const [panel, setPanel] = useState(null);
  const [reminderTick, setReminderTick] = useState(0);
  const latest = useRef(null), executing = useRef(false);
  latest.current = { request, showToast, tellReady };
  useEffect(() => {
    if (!session?.user || session.user.guest || session.offline) return;
    let active = true, checking = false;
    async function check() {
      if (!active || checking || !navigator.onLine) return;
      checking = true;
      try {
        const data = await latest.current.request('/api/chats?resource=commands&view=reminders');
        if (!active) return;
        for (const item of data.reminders.filter(item => !item.done && item.at <= Date.now())) {
          if (!active) break;
          try { await latest.current.request('/api/chats?resource=commands', { action: 'reminder-delivered', id: item.id, at: item.at }); }
          catch { continue; }
          if (active) { latest.current.showToast({ text: `Reminder: ${item.text}` }); void latest.current.tellReady('Vaelo reminder', item.text, { reminder: true }); }
        }
      } catch { /* Retry account reminders on the next poll, never invent delivery. */ }
      finally { checking = false; }
    }
    void check(); const timer = setInterval(check, 30000);
    addEventListener('focus', check); addEventListener('online', check);
    return () => { active = false; clearInterval(timer); removeEventListener('focus', check); removeEventListener('online', check); };
  }, [session?.user?.sub, session?.offline, reminderTick]);
  // A failed/stopped compaction never replaces history. The full transcript
  // stays visible and synced; only subsequent request context is shortened.
  useEffect(() => {
    let changed = false;
    const next = chats.map(item => {
      const summary = item.messages.findLast(m => m.slashCommand === 'compact' && !m.running && !m.failed && !m.stopped && !m.interrupted && !m.truncated && m.completedAt && m.content?.trim());
      if (!summary || item.compaction?.through === summary.id) return item;
      changed = true;
      return { ...item, compaction: { through: summary.id, summary: summary.content.slice(0, 24000) } };
    });
    if (changed) setChats(next);
  }, [chats, setChats]);
  function close() { setPanel(null); setReminderTick(tick => tick + 1); requestAnimationFrame(() => textarea.current?.focus({ preventScroll: true })); }
  function archive(id, archived = true) {
    setChats(current => current.map(item => item.id === id ? { ...item, archived, updated: Date.now() } : item));
    if (archived) { newChat(true); showToast({ text: 'Conversation archived.', action: 'Undo', onAction: () => archive(id, false) }); }
  }
  async function run({ name, args = '', command = SLASH_COMMANDS.find(item => item.name === name) }) {
    if (executing.current) return;
    if (!command) { showToast({ text: `Unknown command /${name}. Use /help to browse commands. To send a literal slash, add a space before it.` }); return; }
    if (command.account && (!session?.user || session.user.guest)) { showToast({ text: `Sign in to use /${name}.` }); return; }
    const needIdle = command.ai || ['branch', 'archive', 'temporary'].includes(name);
    if (needIdle && busy) { showToast({ text: 'Stop the current response before using this command.' }); return; }
    if (command.ai && !online) { showToast({ text: 'Reconnect to send an AI request.' }); return; }
    if (command.args.startsWith('<') && !args) { setDraft(`/${name} `); showToast({ text: `Add ${command.args.slice(1, -1)} after /${name}.` }); return; }
    executing.current = true;
    try {
      if (name === 'stop') { stopReply(); setDraft(''); }
      else if (name === 'new') { setDraft(''); newChat(); }
      else if (name === 'settings') { setDraft(''); setSettingsOpen(true); }
      else if (name === 'theme' && args || name === 'presentation' && args) {
        const allowed = name === 'theme' ? ['light', 'dark', 'system'] : ['adaptive', 'minimal'];
        if (!allowed.includes(args)) throw new Error(`Choose ${allowed.join(', ')}.`);
        setPrefs(current => ({ ...current, [name]: args })); setDraft('');
      }
      else if (name === 'workspace') { setDraft(''); setWorkroomOpen(true); }
      else if (name === 'library') { setDraft(''); setSaved(true); }
      else if (name === 'detach') { setChats(current => current.map(item => item.id === chat?.id ? { ...item, workContext: undefined, updated: Date.now() } : item)); setDraft(''); }
      else if (name === 'rename' && args) { renameChat(args.slice(0, 100)); setDraft(''); }
      else if (name === 'pin') { togglePin(chat.id); setDraft(''); }
      else if (name === 'archive') { setDraft(''); archive(chat.id); }
      else if (name === 'temporary') {
        const temporary = { id: crypto.randomUUID(), title: 'Temporary conversation', messages: [], temporary: true, updated: Date.now() };
        setChats(current => [...current, temporary]); setDraft(''); selectChat(temporary.id);
        showToast({ text: 'Temporary chat: no saved history or account memory. Cloud providers still process your requests.' });
      } else if (name === 'export' && args) {
        if (!['md', 'json', 'txt'].includes(args)) throw new Error('Choose /export md, /export json or /export txt.');
        const content = args === 'json' ? JSON.stringify(chat, null, 2) : `# ${chat.title}\n\n${transcriptOf(chat)}`;
        const safe = chat.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 60) || 'conversation';
        if (!await download(`${safe}.${args}`, content, args === 'json' ? 'application/json' : args === 'md' ? 'text/markdown' : 'text/plain')) throw new Error('Export was cancelled.');
        setDraft('');
      } else if (name === 'copy' && args) {
        if (!['last', 'chat'].includes(args)) throw new Error('Choose /copy last or /copy chat.');
        const text = args === 'chat' ? transcriptOf(chat) : chat.messages.findLast(item => item.role === 'assistant' && item.content)?.content;
        if (!text) throw new Error('There is no answer to copy yet.');
        await copyText(text); setDraft(''); showToast({ text: 'Copied.' });
      } else if (name === 'shortcuts' && args) {
        const data = await request('/api/chats?resource=commands'); const shortcut = data.shortcuts.find(item => item.name === args);
        if (!shortcut) throw new Error('That shortcut does not exist. Use /shortcuts to manage saved prompts.');
        setDraft(shortcut.prompt);
      } else if (command.ai) {
        if (['compact', 'continue', 'retry'].includes(name) && !chat?.messages.length) throw new Error('Start a conversation before using this command.');
        if (name === 'retry' && !chat.messages.some(m => m.role === 'user')) throw new Error('There is no request to retry.');
        setDraft('');
        // Pass mode with the request instead of relying on a future React render.
        void send(name === 'retry' ? { retry: true } : { text: promptForCommand(name, args), slashCommand: name,
          modeOverride: ['research', 'check'].includes(name) && !session.user.guest ? { research: true } : undefined, useAttachments: true })
          .catch(error => showToast({ text: error.message || 'The AI request could not start.' }));
      } else {
        if (['remind', 'schedule'].includes(name)) { void allowNotifications().catch(() => false); }
        setDraft(''); setPanel({ name, args, key: crypto.randomUUID() });
      }
    } catch (error) { showToast({ text: error.message || 'This command could not finish. Try again.' }); }
    finally { executing.current = false; }
  }
  return { run, panel, close, archive };
}
