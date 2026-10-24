"""Read an optional title prefix from the reply call before answer validation."""

import json
import re

TITLE_GUIDANCE = (
    '\n\nPrefix your final answer with <vaelo-title>title</vaelo-title> and a newline. '
    'Title: 2-6 words, at most 48 characters, in the user\'s language; '
    'capture the first request\'s topic and distinctive search keywords (names, products, task). '
    'No filler, quotes, markup, or private identifiers. Metadata is removed; answer normally afterward, respecting exact-output requests.'
)

JSON_TITLE_GUIDANCE = (
    '\n\nReturn {"_vaelo_title":"short search-friendly title",'
    '"_vaelo_answer":<requested JSON object>}. Title: 2-6 words, at most 48 characters, '
    'from the first request, in the user\'s language. This envelope is removed; '
    'the inner answer must follow the requested schema exactly.'
)


def title_messages(messages, enabled, *, json_mode=False):
    if not enabled:
        return messages
    guide = JSON_TITLE_GUIDANCE if json_mode else TITLE_GUIDANCE
    result = list(messages)
    at = next((i for i, message in enumerate(result) if message.get('role') == 'system'), None)
    if at is None:
        result.insert(0, {'role': 'system', 'content': guide.strip()})
    else:
        result[at] = {**result[at], 'content': result[at]['content'] + guide}
    return result


def fallback_title(messages):
    first = next((message.get('content') for message in messages if message.get('role') == 'user'), '')
    if isinstance(first, list):
        text = ' '.join(part.get('text', '') for part in first if isinstance(part, dict) and part.get('type') == 'text')
        if not text.strip():
            return 'Image discussion'
    else:
        text = first if isinstance(first, str) else ''
    text = re.split(r'\n\n(?:Attached file: |\[Vaelo request:|\[Selected Vaelo workspace:)', text, maxsplit=1)[0]
    text = text.strip()
    for _ in range(4):
        text = re.sub(r"^(?:(?:can|could|would|will) you\s+|please\s+|help me\s+(?:(?:to|with)\s+)?|(?:i want|i need|i would like|i'd like)\s+(?:you\s+)?to\s+|what(?:'s| is)\s+(?:the\s+)?)", '', text, flags=re.I)
    text = re.sub(r'https?://\S+', '', text)
    text = re.sub(r'\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\b(?:sk-|gsk_|AIza)[\w-]+|\b\d{3}[- ]\d{2}[- ]\d{4}\b|\b\d{7,}\b', '', text)
    text = re.sub(r'[`*_#<>]', '', text)
    words = re.findall(r"[^\W_]+(?:[.'’+/#-][^\W_]+)*|[×÷=]", text, flags=re.UNICODE)
    candidate = ' '.join(words[:6])
    # Oversized source prompts must still produce a bounded fallback.
    candidate = candidate[:120]
    return concise_title(candidate) or 'New conversation'


def concise_title(value):
    title = ' '.join(value.split()).strip('"\'')
    if not title or len(title) > 120 or any(c in title for c in '<>`*'):
        return None
    # Keep complete keywords if the model overlooks the requested length.
    title = ' '.join(title.split()[:6])
    if len(title) > 48:
        title = title[:49].rsplit(' ', 1)[0] if ' ' in title[:49] else title[:48]
    return title.rstrip(' ,:;-–—') or None


class TitleFilter:
    def __init__(self, *, json_mode=False):
        self.buffer = ''
        self.done = False
        self.title = None
        self.separator = False
        self.json_mode = json_mode

    def feed(self, text, final=False):
        if self.done:
            # The metadata line ending may arrive in a later stream chunk.
            if self.separator:
                self.buffer += text
                if self.buffer in ('', '\r') and not final:
                    return ''
                text = self.buffer
                if text.startswith('\r\n'):
                    text = text[2:]
                elif text.startswith('\n'):
                    text = text[1:]
                self.buffer = ''
                self.separator = False
            return text
        self.buffer += text
        if self.json_mode:
            if not final and len(self.buffer) <= 160000:
                return ''
            result = self.buffer
            try:
                envelope = json.loads(result)
                if isinstance(envelope, dict) and set(envelope) == {'_vaelo_title', '_vaelo_answer'} and isinstance(envelope['_vaelo_title'], str):
                    self.title = concise_title(envelope['_vaelo_title'])
                    result = json.dumps(envelope['_vaelo_answer'], ensure_ascii=False)
            except (ValueError, RecursionError):
                pass
            self.buffer = ''
            self.done = True
            return result
        value = self.buffer.lstrip()
        opening, closing = '<vaelo-title>', '</vaelo-title>'
        if opening.startswith(value) and not final:
            return ''
        if value.startswith(opening):
            end = value.find(closing)
            if end < 0 and len(value) <= 512 and not final:
                return ''
            if end >= 0:
                self.title = concise_title(value[len(opening):end])
                result = value[end + len(closing):]
                self.separator = True
            else:
                # An unfinished metadata prefix must never become an answer.
                result = ''
        else:
            result = self.buffer
        self.buffer = ''
        self.done = True
        return self.feed(result, final=final)
