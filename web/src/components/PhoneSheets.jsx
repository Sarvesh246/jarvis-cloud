import React from "react";
import {
  ArrowUpRight,
  BookOpen,
  ChatsCircle,
  Export,
  Flask,
  FolderSimplePlus,
  Globe,
  Newspaper,
  PlayCircle,
  PushPin,
  PushPinSlash,
  SealCheck,
  Trash,
} from "@phosphor-icons/react";
import { Sheet } from "./Sheet.jsx";
import { useSources } from "./blocks/Blocks.jsx";
import { SourceRail } from "./SourceRail.jsx";
import { kindLabel } from "../lib/sources.js";

/* The conversation as plain text, for sharing or saving a copy */
export function transcriptOf(chat) {
  return (chat?.messages || [])
    .filter((message) => (message.role === "user" ? message.text ?? message.content : message.content))
    .map((message) => {
      const mine = message.role === "user";
      return `**${mine ? "You" : "Vaelo"}**\n\n${mine ? message.text ?? message.content : message.content}`;
    })
    .join("\n\n");
}

function Row({ icon: Icon, tone, disabled, onClick, children }) {
  return (
    <button className="sh-row" data-tone={tone} disabled={disabled} onClick={onClick}>
      <Icon size={22} />
      <span className="sh-row-text">{children}</span>
    </button>
  );
}

/* The conversation's own actions, from the ⋯ in its header */
export function ChatMenuSheet({ open, chat, guest, busy, onClose, onPin, onSaveAsWorkspace, onShare, onRemove }) {
  return (
    <Sheet open={open} onClose={onClose} label="Conversation options">
      <div className="sh-rows">
        <Row icon={chat?.pinned ? PushPinSlash : PushPin} onClick={onPin}>
          {chat?.pinned ? "Unpin" : "Pin"}
        </Row>
        {!guest && (
          <Row icon={FolderSimplePlus} onClick={onSaveAsWorkspace} disabled={busy}>
            Save as a workspace
          </Row>
        )}
        <Row icon={Export} onClick={onShare}>
          Share or export
        </Row>
        <Row icon={Trash} tone="clay" onClick={onRemove} disabled={busy}>
          Remove conversation
        </Row>
      </div>
    </Sheet>
  );
}

const TYPE_ICONS = {
  official: SealCheck,
  news: Newspaper,
  research: Flask,
  reference: BookOpen,
  social: ChatsCircle,
  video: PlayCircle,
  web: Globe,
};

function SourcesBody({ message, focus }) {
  const sources = useSources(message?.content);
  return (
    <>
      <h2 className="sh-title">Sources</h2>
      {sources.length ? (
        <>
          <p className="sh-note">
            Sources can be incomplete, out of date or wrong. Open the ones that matter and check them.
          </p>
          <SourceRail sources={sources} focus={focus} />
        </>
      ) : (
        <p className="sh-empty">This reply didn’t link any sources.</p>
      )}
    </>
  );
}

/* The sources behind a reply: a number, the title, what kind and where from */
export function SourcesSheet({ open, message, focus, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} label="Sources">
      <SourcesBody message={message} focus={focus} />
    </Sheet>
  );
}
