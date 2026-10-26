import { backupFixtures } from './backup-status.js';

export const tableRenderingFixtures = [
  ...backupFixtures.filter(f => ['markdown', 'code', 'unicode', 'unbroken', 'partial', 'legacy', 'table'].includes(f.id)),
  { id: 'table-math', mathCount: 3, content: '| $x^2$ | Value |\n| --- | --- |\n| $\\frac{1}{2}$ | Half |\n| $y_2$ | Index |',
    tsv: 'x^2\tValue\n\\frac{1}{2}\tHalf\ny_2\tIndex',
    csv: 'x^2,Value\r\n\\frac{1}{2},Half\r\ny_2,Index' },
  { id: 'table-alignment', alignments: ['left','center','right','left'], content: '| Left | Center | Right | Numeric left |\n| :--- | :---: | ---: | :--- |\n| Alpha | Beta | Gamma | 12 |\n| Other | Text | End | 24 |' },
  { id: 'table-mixed', mathCount: 2, content: '| Formula | Meaning |\n| --- | --- |\n| **$x^2$** | **Bold** and `code` |\n| $\\sqrt{2}$ | مرحبا 👋 日本語 |' },
  { id: 'table-malformed', content: '| Expression | Status |\n| --- | --- |\n| $\\frac{1}{2$ | Literal fallback |\n| `x^2` | Code |' },
  { id: 'table-partial', running: true, content: '| Expression | Value |\n| --- | --- |\n| $x^2$ | 4 |\n| $y_' },
  { id: 'table-wide-math', mathCount: 1, content: '| Formula | Description |\n| --- | --- |\n| $a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}$ | A wide inline expression |' },
  { id: 'table-display-math', mathCount: 2, content: '| $$x^2$$ | Meaning |\n| --- | --- |\n| $$\\frac{1}{2}$$ | Half |' },
];
