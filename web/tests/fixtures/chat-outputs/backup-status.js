export const backupFixtures = [
  { id: 'plain', content: 'A clear answer with a short paragraph.' },
  { id: 'long', content: 'A longer answer with unchanged source text.\n\n'.repeat(35) },
  { id: 'markdown', content: '# Overview\n\n> A quotation\n\n- First\n  - Nested\n- [x] Finished\n\n[Example](https://example.com)' },
  { id: 'table', content: '| Item | Value |\n|:---|---:|\n| Alpha | 12 |\n| Beta | 24 |' },
  { id: 'code', content: '```javascript\nconst greeting = "Hello 👋";\nconsole.log(greeting);\n```\n\n```python\nprint("Hello")\n```' },
  { id: 'math', content: 'Inline $x^2 + y^2$ and a display:\n\n$$\n\\sum_{n=1}^{10}n = 55\n$$' },
  { id: 'unicode', content: 'مرحبا بالعالم — 日本語 — café — 👩🏽‍💻' },
  { id: 'unbroken', content: 'identifier_'.repeat(240) },
  { id: 'partial', content: 'The unfinished example:\n\n```javascript\nconst result = {', running: true },
  { id: 'legacy', user: [{ type: 'text', text: 'A saved multipart question.' }], content: 'A saved reply with **formatting**.' },
];
