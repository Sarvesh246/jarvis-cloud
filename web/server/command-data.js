import { AccountRecord } from './account-record.js';
import { HttpError, sameOrigin, readJson, json } from './security.js';
import { randomUUID } from 'node:crypto';

export function checkCommandData(data) {
  if (!data || !Array.isArray(data.shortcuts) || !Array.isArray(data.reminders) || data.shortcuts.length > 50 || data.reminders.length > 100)
    throw new Error('Invalid command preferences.');
  for (const item of data.shortcuts) if (!/^[a-z][a-z0-9-]{0,31}$/.test(item.name) || typeof item.prompt !== 'string' || !item.prompt.trim() || item.prompt.length > 8000)
    throw new Error('Invalid shortcut.');
  for (const item of data.reminders) if (typeof item.id !== 'string' || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 500 ||
    !Number.isFinite(item.at) || !['once', 'daily', 'weekly'].includes(item.repeat) || typeof item.done !== 'boolean') throw new Error('Invalid reminder.');
  return data;
}
const recordOptions = { empty: () => ({ shortcuts: [], reminders: [] }), check: checkCommandData };
// Reminder checks never read the potentially much larger prompt shortcuts.
export const commandRecord = new AccountRecord('command-shortcuts', recordOptions);
export const reminderRecord = new AccountRecord('command-reminders', recordOptions);
export async function commandDataApi(req, res, cfg, user, record, now = Date.now) {
  const view = new URL(req.url || '/', cfg.origin).searchParams.get('view');
  if (!record && req.method === 'GET') {
    if (view === 'reminders') record = reminderRecord;
    else if (view === 'shortcuts') record = commandRecord;
    else {
      const [shortcuts, reminders] = await Promise.all([commandRecord.read(user.sub), reminderRecord.read(user.sub)]);
      return json(res, 200, { shortcuts: shortcuts.data.shortcuts, reminders: reminders.data.reminders });
    }
  }
  if (req.method === 'GET') return json(res, 200, (await record.read(user.sub)).data);
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  sameOrigin(req, cfg);
  const body = await readJson(req, 12000);
  record ??= typeof body?.action === 'string' && body.action.startsWith('reminder-') ? reminderRecord : commandRecord;
  const data = await record.update(user.sub, value => {
    if (body?.action === 'shortcut-save') {
      if (typeof body.name !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(body.name) || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 8000)
        throw new HttpError(400, 'Use a short lowercase name and a prompt under 8,000 characters.');
      value.shortcuts = value.shortcuts.filter(item => item.name !== body.name);
      if (value.shortcuts.length >= 50) throw new HttpError(400, 'Keep up to 50 shortcuts.');
      value.shortcuts.push({ name: body.name, prompt: body.prompt.trim() });
    } else if (body?.action === 'shortcut-remove') value.shortcuts = value.shortcuts.filter(item => item.name !== body.name);
    else if (body?.action === 'reminder-add') {
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 500 || !Number.isFinite(body.at) || body.at <= now() || body.at > now() + 366 * 86400000 || !['once', 'daily', 'weekly'].includes(body.repeat))
        throw new HttpError(400, 'Choose a future time within one year and a message under 500 characters.');
      if (value.reminders.length >= 100) throw new HttpError(400, 'Keep up to 100 reminders.');
      value.reminders.push({ id: randomUUID(), text: body.text.trim(), at: body.at, repeat: body.repeat, done: false });
    } else if (body?.action === 'reminder-remove') value.reminders = value.reminders.filter(item => item.id !== body.id);
    else if (body?.action === 'reminder-delivered') {
      const item = value.reminders.find(item => item.id === body.id);
      // Claim with compare-and-swap before showing a notification, so two
      // signed-in devices cannot both deliver the same occurrence.
      if (!item || item.done || item.at !== body.at || item.at > now()) throw new HttpError(409, 'This reminder has already changed.');
      if (item.repeat === 'once') item.done = true;
      else { const step = (item.repeat === 'daily' ? 1 : 7) * 86400000;
        item.at += (Math.floor((now() - item.at) / step) + 1) * step; }
    } else throw new HttpError(400, 'Invalid command action.');
    return value;
  });
  return json(res, 200, data);
}
