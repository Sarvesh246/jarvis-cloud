// Development-only coverage of real output components; no production auth or APIs.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader/opsz.css';
import '../../src/design/tokens.css';
import '../../src/design/base.css';
import '../../src/components/message.css';
import { Header } from '../../src/components/Header.jsx';
import { Rendered, PresentationContext } from '../../src/components/blocks/Blocks.jsx';
import { Workspace } from '../../src/components/Workspace.jsx';
import { collectSources } from '../../src/lib/sources.js';

const names = ['North-west customer operations and after-sales support', 'Independent stores and regional distribution', 'Product engineering and accessibility research'];
const longTable = '| Department | Revenue | Change |\n|---|---:|---:|\n' + Array.from({length: 120}, (_, i) => `| ${names[i % 3]} ${i + 1} | $${(i % 7 ? 1 : -1) * (943 + i * 127)} | ${i % 9 - 4}% |`).join('\n');
const timeTable = '| Month | Revenue |\n|---|---:|\n' + Array.from({length: 96}, (_, i) => `| ${2019 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')} | $${Math.round(1200 + i * 93 + Math.sin(i) * 400)} |`).join('\n');
const samples = {
  'Long comparison': '# Department comparison\n\n' + longTable,
  'Long time series': '# Monthly revenue\n\n' + timeTable,
  'Figures and timeline': '```metrics\n# A very long financial summary heading that must wrap comfortably on a phone\nRevenue: $123,456,789.99 (+12.8%)\nActive subscribers worldwide: 12,438 (+6.2%)\nOutstanding customer commitments: $8,293,120.50\n> Preliminary figures, subject to reconciliation.\n# Additional information\nSource numbers may be revised.\n```\n\n```timeline\n# Release plan\nEarly October, pending final accessibility verification: Public beta — Include every outstanding keyboard and screen-reader check.\nNovember: General availability — Roll out to remaining regions in stages.\nUnscheduled work remains visible.\n```',
  'Code and prose': '# Implementation notes\n\nA paragraph with **emphasis**, `inline_code`, a [source](https://example.com/a-very-long-reference-address), and a blockquote.\n\n> Long explanations should retain comfortable line lengths and spacing.\n\n```javascript\n' + Array.from({length: 42}, (_, i) => `const record${i} = { description: "${'A readable but deliberately long value. '.repeat(4)}", count: ${i} };`).join('\n') + '\n```\n\n```html\n<h1>A preview</h1><p>A simple, isolated HTML document.</p>\n```',
  'Tasks and numbers': '## Preparation checklist\n\n- [ ] Review the complete response and confirm that every figure has a source.\n- [x] Export the original table.\n- [ ] Verify keyboard operation and narrow-screen layouts.\n\n## Budget\n\n| Expense | Amount |\n|---|---:|\n| Travel and accommodation for the regional team | $1493.25 |\n| Materials | $217.50 |\n| Other costs | $83 |',
  'Sources, images and draft': '# Reference material\n\nRead [the full research report with a long descriptive title](https://example.com/research) and [official guidance](https://www.who.int/).\n\n![Remote diagram description that remains visible even without loading a third-party image](https://example.com/diagram.png)\n\n![A deliberately broken inline image](data:image/png;base64,AAAA)\n\n```vaelo-work\n{"workspaceId":"custom","title":"Review the international client delivery plan and outstanding commitments","notes":"Check all dates and figures before saving."}\n```',
  'Malformed and empty': '```metrics\n# Empty figures\n```\n\n```timeline\n# Empty timeline\n```\n\n```vaelo-work\n{broken json}\n```\n\n| Item | Value |\n|---|---|\n| Missing | N/A |\n| Unknown | — |',
};
function Fixture() {
  const [scenario, setScenario] = useState(Object.keys(samples)[0]);
  const [theme, setTheme] = useState('light');
  const [minimal, setMinimal] = useState(false);
  const [live, setLive] = useState(false);
  const [item, setItem] = useState(null);
  const [title, setTitle] = useState('Compare the iPhone 18 Pro Max to my current iPhone and explain which upgrade makes sense');
  const content = samples[scenario];
  const open = next => setItem(next.kind === 'work-proposal' ? {kind:'document', messageId:'sample'} : next);
  document.documentElement.dataset.theme = theme;
  return <PresentationContext.Provider value={minimal ? 'minimal' : 'adaptive'}>
    <div style={{maxWidth: 1440, margin:'auto', minWidth:0}}>
      <Header title={title} canRename onRename={setTitle} onSaveAsWorkspace={() => open({kind:'document',messageId:'sample'})} />
      <nav style={{display:'flex',flexWrap:'wrap',gap:12,padding:16}} aria-label="Fixture controls">
        <label>Scenario <select value={scenario} onChange={e => {setScenario(e.target.value);setItem(null);}}>{Object.keys(samples).map(name => <option key={name}>{name}</option>)}</select></label>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>Toggle theme</button>
        <label><input type="checkbox" checked={minimal} onChange={e => setMinimal(e.target.checked)} /> Minimal</label>
        <label><input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} /> Streaming</label>
      </nav>
      <main style={{maxWidth: 850, padding:'24px clamp(16px, 4vw, 40px)', margin:'auto', minWidth:0}}>
        <article className="prose" key={`${scenario}:${minimal}:${live}`}><Rendered content={content} sources={collectSources(content)} stateKey={`output-fixture:${scenario}`} live={live} onOpen={open} /></article>
        <button onClick={() => open({kind:'document',messageId:'sample'})}>Open as document</button>
      </main>
      <Workspace item={item} messages={[{id:'sample',content}]} works={{}} canRevise={false} onClose={() => setItem(null)} onOpen={open} />
    </div>
  </PresentationContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
