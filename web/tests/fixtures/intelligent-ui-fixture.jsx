// Development-only fixture: actual renderer, fixed data, no model requests.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader/opsz.css';
import '../../src/design/tokens.css';
import '../../src/design/base.css';
import '../../src/components/message.css';
import { Rendered, PresentationContext } from '../../src/components/blocks/Blocks.jsx';

const content = `## A clearer view of your week

Three options, compared using the same figures. Try filtering, selecting rows, or changing the chart view.

| Plan | Monthly cost | Change | Best for |
| --- | ---: | ---: | --- |
| Flexible monthly membership | $48 | -12% | Trying the studio before committing |
| Annual membership paid monthly | $36 | 8% | Regular visits throughout the year |
| Ten-visit pass | $65 | 0% | Occasional visits without a renewal |

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
  const [minimal, setMinimal] = useState(false), [live, setLive] = useState(false), [narrow, setNarrow] = useState(false);
  return <main style={{ maxWidth: narrow ? 350 : 900, margin: 'auto', padding: '1rem' }}>
    <h1>Interactive reply checks</h1>
    <p>Fixed sample data. No model calls. Use narrow mode to inspect mobile wrapping.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
      <button onClick={() => setMinimal(v => !v)}>Toggle minimal</button>
      <button onClick={() => setLive(v => !v)}>Toggle streaming</button>
      <button onClick={() => setNarrow(v => !v)}>Toggle narrow</button>
      <button onClick={() => document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'}>Toggle theme</button>
    </div>
    <PresentationContext.Provider value={minimal ? 'minimal' : 'adaptive'}>
      <div className="prose"><Rendered content={content} sources={[]} onOpen={() => {}} stateKey="intelligent-ui-fixture" live={live} /></div>
    </PresentationContext.Provider>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
