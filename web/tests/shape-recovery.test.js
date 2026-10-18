import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Typical answers that ignore the requested format must still reach a visual.
const samples = [
  ["itinerary-headings", "Plan a 3-day trip to Lisbon.", "Here's a simple plan.\n\n### Day 1: Alfama and the old town\n- Morning: Walk the Alfama streets\n- Afternoon: Visit the castle\n- Evening: Fado dinner\n\n### Day 2: Belém\n- Morning: Jerónimos Monastery\n- Afternoon: Tower of Belém\n\n### Day 3: Sintra\n- Take the train to Sintra\n- Visit Pena Palace", "class=\"timeline\""],
  ["compare-sections", "Compare React and Vue for a small team.", "### React\n- **Learning curve:** Moderate\n- **Ecosystem:** Huge\n- **Best for:** Large apps\n\n### Vue\n- **Learning curve:** Gentle\n- **Ecosystem:** Smaller\n- **Best for:** Small teams", "table-block"],
  ["metrics-bullets", "How did Q3 go? Revenue was 4.2M up 12%, churn 3.1% down 0.4 points, 1204 customers.", "Q3 looks healthy:\n\n- **Revenue:** $4.2M (+12%)\n- **Churn:** 3.1% (−0.4 pts)\n- **Customers:** 1,204", "class=\"metrics\""],
  ["packing-groups", "What should I pack for Iceland in March?", "**Clothing**\n- Waterproof shell jacket\n- Thermal base layers\n- Wool socks\n\n**Gear**\n- Headlamp\n- Power adapter\n- Reusable water bottle", "local-checklist"],
  ["workout-week", "Give me a weekly workout plan.", "**Monday:** Chest and triceps\n**Tuesday:** Back and biceps\n**Wednesday:** Rest\n**Thursday:** Legs", "class=\"timeline\""],
  ["how-to-steps", "How do I reset my router?", "1. Unplug the router.\n2. Wait 30 seconds.\n3. Plug it back in.\n4. Wait for the lights to settle.", "after-steps"],
  ["numbers-prose", "How did sales change by quarter?", "Sales grew steadily through the year. Q1: $120k, Q2: $150k, Q3: $180k, Q4: $240k.", "chart"],
  ["ranked-list", "What are the five largest US cities by population?", "1. New York — 8.3 million\n2. Los Angeles — 3.9 million\n3. Chicago — 2.7 million\n4. Houston — 2.3 million\n5. Phoenix — 1.6 million", "table-block"],
  ["pros-cons", "Pros and cons of remote work?", "**Pros**\n- Flexible schedule\n- No commute\n\n**Cons**\n- Isolation\n- Harder to unplug", "table-block"],
  ["history-bullets", "Give me a timeline of the Apollo program.", "- 1961: Kennedy announces the goal\n- 1967: Apollo 1 fire\n- 1969: Apollo 11 lands on the Moon\n- 1972: Apollo 17, final mission", "class=\"timeline\""],
  ["pipe-table", "Compare two phones.", "| Phone | Price |\n|---|---|\n| A | $500 |\n| B | $700 |", "table-block"],
  ["plain-chat", "What is the capital of France?", "Paris.", "<p>"],
];


test('answers shaped like itineraries, comparisons, rankings and series reach visuals unprompted', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  try {
    const { Message } = await server.ssrLoadModule('/src/components/Message.jsx');
    for (const [name, requestText, content, want] of samples) {
      const html = renderToStaticMarkup(React.createElement(Message, { message: { id: 'p-' + name, role: 'assistant', content, createdAt: 1 }, requestText, isLast: true, busy: false, live: false, onAction() {} }));
      assert.ok(html.includes(want), name + ' expected ' + want);
    }
  } finally {
    await server.close();
  }
});
