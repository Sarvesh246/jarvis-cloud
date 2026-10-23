// A cached empty conversation may belong to another tab. Only restore an
// explicitly remembered conversation; every other launch owns a new draft.
export function openingChat(saved, rememberedId, shortcut, create, own) {
  if (!shortcut && own?.id === rememberedId && Array.isArray(own.messages)) {
    const shared = saved.find(chat => chat.id === rememberedId);
    // Another tab may have acknowledged the empty draft before this tab sent
    // its first message. Its stale cache must not replace our submitted turn.
    if (!shared || own.messages.length > shared.messages.length &&
        shared.messages.every((message,index)=>message.id===own.messages[index]?.id))
      saved = [own, ...saved.filter(chat=>chat.id!==rememberedId)];
  }
  if (!shortcut && saved.some(chat => chat.id === rememberedId))
    return { list: saved, id: rememberedId };
  const chat = create();
  return { list: [chat, ...saved], id: chat.id };
}
