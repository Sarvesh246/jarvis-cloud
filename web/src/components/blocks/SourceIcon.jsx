import React from "react";
import {
  Bank,
  BookBookmark,
  ChatsCircle,
  Exam,
  Globe,
  Newspaper,
  PlayCircle,
} from "@phosphor-icons/react";

/* Source type is always shown as a shape as well as a word, never as colour
   alone. */
const ICONS = {
  social: ChatsCircle,
  video: PlayCircle,
  research: Exam,
  official: Bank,
  news: Newspaper,
  reference: BookBookmark,
  web: Globe,
};

export function SourceIcon({ kind = "web", size = 14 }) {
  const Icon = ICONS[kind] || Globe;
  return <Icon size={size} aria-hidden="true" />;
}
