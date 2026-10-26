import { backupFixtures } from './backup-status.js';

const sources = count => Array.from({ length: count }, (_, i) =>
  `[Reference ${i + 1}](https://site${i + 1}.example)`).join(' ');

export const accessibilityFixtures = [
  ...backupFixtures,
  { id: 'sources-versions', content: sources(3), versionCount: 3 },
  { id: 'many-sources-versions', content: sources(12), versionCount: 12 },
  { id: 'single-source', content: sources(1) },
  { id: 'versions', content: 'A reply with several saved versions.', versionCount: 3 },
];
