// Fixed ordinary requests and Markdown answers, rendered without model calls.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader/opsz.css';
import '../../src/design/tokens.css';
import '../../src/design/base.css';
import '../../src/components/message.css';
import { PresentationContext, Rendered } from '../../src/components/blocks/Blocks.jsx';

import "../../src/design/refinements.css";

const samples = [
  ['Packing', 'Help me pack for a weekend away.', '## Packing list\n- Water bottle\n- A warm layer\n- Phone charger'],
  ['Timeline', 'Plan a relaxed Saturday morning.', '## Saturday morning\n- 9 AM: Breakfast — Take your time.\n- 10:30 AM: Walk — Visit the park.\n- 12 PM: Lunch — Try the market.'],
  ['Figures', 'Summarize these results: revenue $12450, orders 183, refunds 7.', '## Weekly results\n- **Revenue:** $12,450\n- **Orders:** 183\n- **Refunds:** 7'],
  ['Chart', 'Help me understand these monthly sales.', '## Monthly sales\n| Month | Sales |\n| --- | ---: |\n| January | 120 |\n| February | 180 |\n| March | 145 |'],
  ['Comparison', 'Help me choose between these two plans.', '## Compare options\n| Plan | Monthly cost |\n| --- | ---: |\n| Basic | $20 |\n| Plus | $30 |'],
  ['Quantities', 'Help me adjust this recipe.', '## Recipe for four\n| Ingredient | Amount | Unit |\n| --- | ---: | --- |\n| Rice | 300 | g |\n| Beans | 400 | g |'],
  ['Bento (drawn)', 'Make me a bento overview of my trip costs.', `Here is your bento overview:

\`\`\`
┌────────┬──────┐
│ Hotel  │ $480 │
├────────┼──────┤
│ Food   │ $160 │
│ Travel │ $75  │
│ **Total** │ **$715** │
└────────┴──────┘
\`\`\``],
  ['Bento (table)', 'Give me a bento overview of my trip costs.', `| Item | Cost |
|---|---|
| Hotel | $480 |
| Food | $160 |
| Total | $715 |`],
  ['Auto cards', 'How much will a weekend in Lisbon cost me?', '## Trip costs\n| Item | Cost |\n| --- | ---: |\n| Hotel | $480 |\n| Food | $160 |\n| Travel | $75 |\n| **Total** | **$715** |'],
  ['Auto tree', 'How should I lay out the project?', 'Use this layout:\n\n```\nweb/\n├── src/\n│   ├── App.jsx\n│   └── main.jsx\n├── package.json\n└── README.md\n```'],
  ['Simple answer', 'What is 2 plus 2?', '2 + 2 = 4.'],
  ['Information list', 'What are the benefits?', '## Benefits\n- Lightweight\n- Flexible\n- Durable'],
];
function Fixture() {
  const [selected, setSelected] = useState(0), [minimal, setMinimal] = useState(false), [live, setLive] = useState(false), [plain, setPlain] = useState(false);
  const [name, request, content] = samples[selected];
  return <main style={{maxWidth:900,margin:'auto',padding:'1rem'}}>
    <h1>Automatic presentation checks</h1>
    <p>Ordinary Markdown answers. No explicit UI requests, structured fences, or model calls.</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:'.75rem',marginBottom:'1.5rem'}}>
      {samples.map(([label], i) => <button key={label} className="chip" aria-pressed={selected === i} onClick={() => setSelected(i)}>{label}</button>)}
      <button onClick={() => setMinimal(v => !v)}>Toggle minimal</button>
      <button onClick={() => setLive(v => !v)}>Toggle streaming</button>
      <button onClick={() => setPlain(v => !v)}>Toggle plain request</button>
      <button onClick={() => document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'}>Toggle theme</button>
    </div>
    <p><strong>Request:</strong> {request}{plain ? ' Plain text please.' : ''}</p>
    <PresentationContext.Provider value={minimal ? 'minimal' : 'adaptive'}>
      <div className="prose"><Rendered key={`${name}:${plain}:${minimal}:${live}`} content={content} requestText={request + (plain ? ' Plain text please.' : '')} sources={[]} onOpen={() => {}} stateKey={`automatic-fixture:${name}`} live={live} /></div>
    </PresentationContext.Provider>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
