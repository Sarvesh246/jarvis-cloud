// Development-only fixture: actual renderer, fixed data, no model requests.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader/opsz.css';
import '../../src/design/tokens.css';
import '../../src/design/base.css';
import '../../src/components/message.css';
import { Settings } from '../../src/components/Settings.jsx';
import { Workspace } from '../../src/components/Workspace.jsx';
import { DEFAULTS } from '../../src/lib/preferences.js';
import { Rendered, PresentationContext } from '../../src/components/blocks/Blocks.jsx';

const content = `## A clearer view of your week

Three options, compared using the same figures. Try filtering, selecting rows, or changing the chart view.

| Plan | Monthly cost | Change | Best for |
| --- | ---: | ---: | --- |
| Flexible monthly membership | $48 | -12% | Trying the studio before committing |
| Annual membership paid monthly | $36 | 8% | Regular visits throughout the year |
| Ten-visit pass | $65 | 0% | Occasional visits without a renewal |

### Longer descriptions should wrap

| Mode | Travel time | Monthly cost | Flexibility | Drawbacks |
| --- | --- | --- | --- | --- |
| Walking | About 60 min | $0 | Low | Weather exposure; cannot carry heavy goods; impractical in poor conditions. |
| Cycling | About 25 min | $15–30 | Medium | Physical effort; bike security; safety concerns; rain and snow challenges. |
| Driving | About 10 min | $60–80 | High | Parking costs, traffic delays, fuel, insurance, and ongoing maintenance. |
| Public transit | About 35 min | $45–70 | Medium | Fixed schedules; transfers; limited evening service; crowded peak journeys. |

~~~metrics
# This week at the studio
Visits: 1,284 (+8%)
New members: 47 (+12%)
Cancellations: 12 (-3%)
> Figures are sample data for the interface check.
~~~

~~~timeline
# Your first week
Monday: Choose a plan — Compare the cost and how often you expect to visit.
Wednesday, 6:30 PM: First class — Arrive ten minutes early to find your way around.
Friday: Review your week — Decide whether the schedule works for you.
~~~

### Before you go
- [x] Choose a convenient time
- [ ] Pack water and a towel
- [ ] Check the cancellation window

### A plan you can track
1. Compare the three options above.
2. Book a first visit that fits your week.
3. Review the experience afterwards.
`;
function Fixture() {
  const [settings, setSettings] = useState(false), [prefs, setPrefs] = useState(DEFAULTS), [workspace, setWorkspace] = useState(null);
  const [minimal, setMinimal] = useState(false), [live, setLive] = useState(false), [narrow, setNarrow] = useState(false);
  return <main style={{ maxWidth: narrow ? 350 : 900, margin: 'auto', padding: '1rem' }}>
    <h1>Interactive reply checks</h1>
    <p>Fixed sample data. No model calls. Use narrow mode to inspect mobile wrapping.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
      <button onClick={() => setSettings(true)}>Open settings</button>
      <button onClick={() => document.documentElement.style.fontSize = document.documentElement.style.fontSize ? "" : "24px"}>Toggle larger text</button>
      <button onClick={() => setMinimal(v => !v)}>Toggle minimal</button>
      <button onClick={() => setLive(v => !v)}>Toggle streaming</button>
      <button onClick={() => setNarrow(v => !v)}>Toggle narrow</button>
      <button onClick={() => document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'}>Toggle theme</button>
      {workspace && <button onClick={() => setWorkspace({ kind: 'table', source: 'fixture-second-table', title: 'Another table', columns: ['Item', 'Value'], rows: [['First', '1'], ['Second', '2']] })}>Switch workspace table</button>}
    </div>
    <PresentationContext.Provider value={minimal ? 'minimal' : 'adaptive'}>
      <div className="prose"><Rendered content={content + `\n\n### Grouped comparison\n\n| Category | Phone A | Phone B |\n| --- | --- | --- |\n` + ["Display", "Processor & Memory", "Camera"].map((section, group) =>
        `| **${section}** | | |\n` + Array.from({ length: 12 }, (_, i) => `| ${section} measure ${i + 1} | ${10 + group * 20 + i} | ${20 + group * 20 + i} |`).join("\n")
      ).join("\n")} sources={[]} onOpen={setWorkspace} stateKey="intelligent-ui-fixture" live={live} /></div>
    </PresentationContext.Provider>
    <Settings open={settings} prefs={prefs} onChange={patch => setPrefs(p => ({ ...p, ...patch }))} onClose={() => setSettings(false)} />
    {workspace && <div style={{position:'fixed',right:0,top:0,zIndex:10}}><Workspace item={workspace} messages={[]} works={{}} canRevise={false} onClose={() => setWorkspace(null)} onOpen={setWorkspace} /></div>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
