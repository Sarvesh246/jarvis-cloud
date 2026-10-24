"""Read an optional title prefix from the reply call before answer validation."""

TITLE_GUIDANCE = (
    '\n\nFor this new conversation, begin your final answer with '
    '<vaelo-title>A short title</vaelo-title> on its own line, then answer normally. '
    'Write a specific 3-7 word title summarizing the initial user request, in their language. '
    'This metadata is removed before displaying or validating the answer, including exact-output requests. '
    'Do not include personal identifiers, quotes, markdown, or commentary in the title.'
)


class TitleFilter:
    def __init__(self):
        self.buffer = ''
        self.done = False
        self.title = None

    def feed(self, text, final=False):
        if self.done:
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
                title = ' '.join(value[len(opening):end].split()).strip('"\'')
                if 0 < len(title) <= 120 and not any(c in title for c in '<>'):
                    self.title = title
                result = value[end + len(closing):].lstrip('\r\n')
            else:
                # An unfinished metadata prefix must never become an answer.
                result = ''
        else:
            result = self.buffer
        self.buffer = ''
        self.done = True
        return result
