import { backupFixtures } from './backup-status.js';

const sources = count => Array.from({ length: count }, (_, i) =>
  `[Reference ${i + 1}](https://site${i + 1}.example)`).join(' ');

export const accessibilityFixtures = [
  ...backupFixtures,
  { id: 'sources-versions', content: sources(3), versionCount: 3 },
  { id: 'many-sources-versions', content: sources(12), versionCount: 12 },
  { id: 'single-source', content: sources(1) },
  { id: 'versions', content: 'A reply with several saved versions.', versionCount: 3 },
  { id: 'wide-table', content: `| ${Array.from({ length: 8 }, (_, i) => `Column ${i + 1}`).join(' | ')} |\n| ${Array(8).fill('---').join(' | ')} |\n${Array.from({ length: 4 }, () => `| ${Array(8).fill('A_long_unbroken_table_value_123456789').join(' | ')} |`).join('\n')}` },
  { id: 'big-code', content: `\`\`\`javascript\n${'const greeting = "Hello 👋 مرحبا";\n'.repeat(80)}\`\`\`\n\n\`\`\`python\n${'print("Hello 日本語")\n'.repeat(20)}\`\`\`` },
  { id: 'malformed-math', content: 'An unfinished expression: $\\frac{1}{ and a malformed display:\n\n$$\\unknowncommand{x}$$' },
  { id: 'interrupted', content: 'The partial **answer** is still available.', state: { interrupted: true, note: 'The connection was lost. Your partial reply is here.' } },
  { id: 'partial-table', content: '| Item | Value |\n| --- | --- |\n| Partial |', running: true },
];
