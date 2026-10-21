// A cached empty conversation may belong to another tab. Only restore an
// explicitly remembered conversation; every other launch owns a new draft.
export function openingChat(saved, rememberedId, shortcut, create) {
  if (!shortcut && saved.some(chat => chat.id === rememberedId))
    return { list: saved, id: rememberedId };
  const chat = create();
  return { list: [chat, ...saved], id: chat.id };
}
