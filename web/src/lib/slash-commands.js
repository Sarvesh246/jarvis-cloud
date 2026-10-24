// One catalog drives discovery, keyboard completion, help and execution.
const command = (name, description, group, args = '', extra = {}) => ({ name, description, group, args, ...extra });
export const SLASH_COMMANDS = [
  command('help', 'Browse commands and examples', 'Vaelo'),
  command('usage', 'Your account’s cloud tokens and context', 'Vaelo', '[today|month|all]'),
  command('context', 'Inspect the current conversation context', 'Vaelo'),
  command('status', 'Connection and current response mode', 'Vaelo'),
  command('new', 'Start a new conversation', 'Conversations'),
  command('search', 'Find conversations, including archived chats', 'Conversations', '[query]'),
  command('rename', 'Rename this conversation', 'Conversations', '[title]'),
  command('pin', 'Pin or unpin this conversation', 'Conversations'),
  command('archive', 'Keep this chat out of your sidebar', 'Conversations'),
  command('branch', 'Continue from a message in a new chat', 'Conversations'),
  command('export', 'Download this conversation', 'Conversations', '[md|json|txt]'),
  command('copy', 'Copy the latest answer or the whole chat', 'Conversations', '[last|chat]'),
  command('stop', 'Stop the current response', 'Conversations', '', { duringRun: true }),
  command('retry', 'Generate another answer to your last message', 'Conversations', '', { ai: true }),
  command('settings', 'Open settings and appearance', 'Preferences'),
  command('theme', 'Choose light, dark or system appearance', 'Preferences', '[light|dark|system]'),
  command('presentation', 'Choose adaptive or minimal replies', 'Preferences', '[adaptive|minimal]'),
  command('profile', 'Review what you tell Vaelo about yourself', 'Preferences'),
  command('attach', 'Choose files for your next message', 'Work'),
  command('files', 'Review and remove pending attachments', 'Work'),
  command('workspace', 'Choose a workspace in Workroom', 'Work', '', { account: true }),
  command('detach', 'Stop using the current workspace', 'Work'),
  command('library', 'Open your saved outputs', 'Work'),
  command('plan', 'Inspect the latest task plan', 'Work'),
  command('summarize', 'Summarize this conversation or your files', 'Ask Vaelo', '[instructions]', { ai: true }),
  command('compact', 'Summarize earlier context for future replies', 'Ask Vaelo', '', { ai: true }),
  command('continue', 'Continue the last answer', 'Ask Vaelo', '', { ai: true }),
  command('research', 'Research a topic with sources', 'Ask Vaelo', '<topic>', { ai: true, account: true }),
  command('explain', 'Explain a topic clearly', 'Ask Vaelo', '<topic>', { ai: true }),
  command('rewrite', 'Rewrite the latest answer or supplied text', 'Ask Vaelo', '<instructions>', { ai: true }),
  command('translate', 'Translate the latest answer or supplied text', 'Ask Vaelo', '<language and optional text>', { ai: true }),
  command('compare', 'Compare options side by side', 'Ask Vaelo', '<items>', { ai: true }),
  command('check', 'Check claims and identify supporting evidence', 'Ask Vaelo', '<claim or text>', { ai: true }),
  command('memory', 'Review and manage your saved notes', 'Account', '', { account: true }),
  command('remember', 'Save a note to your account', 'Account', '<note>', { account: true }),
  command('forget', 'Choose a saved note to delete', 'Account', '[search]', { account: true }),
  command('remind', 'Set an account reminder; alerts while Vaelo is open', 'Account', '[in 20m message]', { account: true }),
  command('schedule', 'Manage reminders and export them to your calendar', 'Account', '', { account: true }),
  command('connect', 'Review your sign-in and connected devices', 'Account', '', { account: true }),
  command('model', 'Inspect automatic model routing', 'Preferences'),
  command('tools', 'Choose research, response style and role', 'Preferences'),
  command('shortcuts', 'Save and reuse personal prompt shortcuts', 'Account', '[name]', { account: true }),
  command('temporary', 'Start an unsaved chat without account memory', 'Conversations'),
];
export function parseSlash(value) {
  const match = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(value.trimEnd());
  if (!match) return null;
  const name = match[1].toLowerCase();
  return { name, args: (match[2] || '').trim(), command: SLASH_COMMANDS.find(item => item.name === name) };
}
export function slashMatches(value, commands = SLASH_COMMANDS) {
  if (!/^\/[\w-]*$/.test(value)) return null;
  const needle = value.slice(1).toLowerCase();
  return commands.filter(item => item.name.startsWith(needle) || item.description.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.name.startsWith(needle)) - Number(a.name.startsWith(needle)));
}
export function promptForCommand(name, args) {
  const prompts = {
    summarize: `Summarize the conversation or attached material. Preserve the key facts, decisions and next actions.${args ? '\n\n' + args : ''}`,
    compact: 'Create a compact handoff summary of this conversation for future replies. Preserve the user’s goal, constraints, decisions, essential facts, unresolved questions and relevant file details. Do not invent details. This summary will replace older messages in the model context, while the visible transcript is kept.',
    continue: 'Continue your last answer from where it ended, without repeating earlier material.',
    research: `Research this topic using current sources and cite the evidence:\n\n${args}`,
    explain: `Explain the following clearly, with examples where useful:\n\n${args}`,
    rewrite: `Rewrite the latest answer, or the text supplied below, following these instructions:\n\n${args}`,
    translate: `Translate the latest answer, or the text supplied below, according to this request:\n\n${args}`,
    compare: `Compare the following options. Explain meaningful similarities, differences and trade-offs:\n\n${args}`,
    check: `Check the following claims against evidence. Distinguish supported, disputed and unverified statements; cite sources you actually consulted:\n\n${args}`,
  };
  return prompts[name];
}
export function contextSnapshot(chat, pending = [], policy) {
  const messages = chat?.messages || [];
  const start = chat?.compaction?.through;
  const at = start ? messages.findIndex(message => message.id === start) : -1;
  const retained = at >= 0 ? messages.slice(at + 1) : messages;
  const chars = retained.reduce((sum, message) => sum + String(message.content || '').length, 0)
    + pending.reduce((sum, file) => sum + (file.chars || 0), 0) + (at >= 0 ? chat.compaction.summary.length : 0);
  // Deliberately labeled as an estimate: provider tokenizers and hidden tool
  // prompts differ. Cumulative billed tokens are never used as context size.
  const reportedAt = retained.findLastIndex(message => message.role === 'assistant' &&
    Number.isSafeInteger(message.usage?.prompt_tokens) && message.usage.prompt_tokens > 0 &&
    Number.isSafeInteger(message.usage?.completion_tokens) && message.usage.completion_tokens >= 0);
  const reported = reportedAt >= 0 ? retained[reportedAt].usage : null;
  const newerChars = reported ? retained.slice(reportedAt + 1).reduce((sum, message) => sum + String(message.content || '').length, 0)
    + pending.reduce((sum, file) => sum + (file.chars || 0), 0) : 0;
  // Use only the newest request's report, never a sum of conversation usage.
  // Its input includes system/workspace prompts invisible to the text counter.
  const empty = !retained.length && !pending.length && at < 0;
  const tokens = empty ? 0 : reported ? reported.prompt_tokens + reported.completion_tokens + Math.ceil(newerChars / 3) : Math.ceil(chars / 3) + 2048;
  const limit = policy.windowTokens;
  return { tokens, limit, percent: Math.min(100, tokens / limit * 100), messages: retained.length,
    omitted: at + 1, files: pending.length, estimated: true, source: empty ? 'empty' : reported ? 'provider' : 'text' };
}
