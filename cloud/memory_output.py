"""Strip internal note directives before streaming; never promote them to prose."""
import re

MARK = re.compile(r'\[\[remember:\s*([^\]\n]{1,600})\]\]', re.I)


def split_notes(text):
    notes = list(dict.fromkeys(match[1].strip()[:280] for match in MARK.finditer(text)))[:3]
    return MARK.sub('', text).rstrip(), notes


class NoteFilter:
    def __init__(self):
        self.pending = ''

    def feed(self, text, final=False):
        self.pending += text
        self.pending = MARK.sub('', self.pending)
        start = self.pending.lower().rfind('[[')
        if start < 0 and self.pending.endswith('['): start = len(self.pending) - 1
        if start >= 0:
            tail = self.pending[start:].lower()
            if '[[remember:'.startswith(tail) or tail.startswith('[[remember:'):
                shown, self.pending = self.pending[:start], self.pending[start:]
                if final: self.pending = ''
                return shown
        shown, self.pending = self.pending, ''
        return shown
