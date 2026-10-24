"""Read an optional title prefix from the reply call before answer validation."""

TITLE_GUIDANCE = (
    '\n\nPrefix your final answer with <vaelo-title>title</vaelo-title> and a newline. '
    'Title: 2-6 words, at most 48 characters, in the user\'s language; '
    'capture the first request\'s topic and distinctive search keywords (names, products, task). '
    'No filler, quotes, markup, or private identifiers. Metadata is removed; answer normally afterward, respecting exact-output requests.'
)


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
    def __init__(self):
        self.buffer = ''
        self.done = False
        self.title = None
        self.separator = False

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
