const rich = (data) => "```vaelo-ui\n" + JSON.stringify(data) + "\n```";
const images = [
  {
    src: "https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=800",
    alt: "Warm studio with open shelving",
  },
  {
    src: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=800",
    alt: "A light filled workspace",
  },
  {
    src: "https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=800",
    alt: "Office with plants",
  },
];
const items = [
  { label: "Total", value: "$715", detail: "Four-day trip · $178.75 per day" },
  { label: "Hotel", value: "$480", detail: "Three nights" },
  { label: "Food", value: "$160", detail: "Four days" },
  { label: "Travel", value: "$75", detail: "Local transport" },
];
export const samples = [
  [
    "Standard text / Markdown",
    "Review the clauses in my lease.",
    "## Reviewing your lease\n\nMost of the agreement is standard. Three clauses deserve a **closer look** before you sign, especially the *early termination* terms in `§14.2`.\n\n### What to check\n\n- Deposit return window (currently 45 days)\n- Who pays for appliance repairs\n- Notice period for renewal\n\n> “The tenant may terminate with sixty days’ written notice and payment of one month’s rent.”\n>\n> Lease, §14.2\n\n---\n\nIf any of these differ from what you were told verbally, ask for the change in writing.",
  ],
  [
    "Interactive tables",
    "Compare these six laptops.",
    "| Model | Price | Battery | Weight | Score |\n|---|---:|---:|---:|---:|\n| Air 13 | $1099 | 18 h | 1.24 kg | 92 |\n| Pro 14 | $1599 | 22 h | 1.55 kg | 96 |\n| ThinkPad | $1299 | 15 h | 1.38 kg | 88 |\n| XPS 13 | $1199 | 14 h | 1.17 kg | 87 |\n| Zenbook | $999 | 16 h | 1.20 kg | 90 |\n| Surface | $1299 | 15 h | 1.34 kg | 89 |",
  ],
  [
    "Bar charts",
    "What changed across regions?",
    "## Regional change\n\n| Region | Change |\n|---|---:|\n| North | 18% |\n| South | -12% |\n| East | 27% |\n| West | -8% |\n| Central | 16% |",
  ],
  [
    "Line charts",
    "How did revenue change over time?",
    "| Month | Revenue |\n|---|---:|\n| Jan | $24000 |\n| Feb | $31000 |\n| Mar | $28000 |\n| Apr | $42000 |\n| May | $39000 |\n| Jun | $58000 |",
  ],
  [
    "Stacked bar charts",
    "Show the monthly revenue breakdown.",
    "| Month | Subscriptions | Services | Other |\n|---|---:|---:|---:|\n| Jan | $18000 | $8000 | $3000 |\n| Feb | $24000 | $10000 | $4000 |\n| Mar | $21000 | $12000 | $5000 |\n| Apr | $28000 | $14000 | $7000 |",
  ],
  [
    "Metric / figure displays",
    "Summarize the key business numbers.",
    "```metrics\n# Business snapshot · vs last month\nRevenue: $124,830 (+12.8%)\nActive users: 8,412 (+6.2%)\nRefund rate: 1.4% (-0.8%)\nAverage order: $148 (+4.1%)\n```",
  ],
  [
    "Timelines",
    "Plan the website relaunch.",
    "```timeline\n# Website relaunch\n2026-10-05: Discovery — Audit the current experience\n2026-10-12: Design — Review page concepts\n2026-10-26: Build — Implement approved layouts\n2026-11-09: Test — Verify devices and accessibility\n2026-11-23: Launch — Roll out the new website\n```",
  ],
  [
    "Interactive checklists",
    "What should I do before the event?",
    "## Event preparation\n\n- [x] Confirm the venue booking\n- [x] Send invitations\n- [ ] Order catering\n- [ ] Arrange AV equipment\n- [ ] Print name badges",
  ],
  [
    "Step-by-step player",
    "Walk me through setting up the project.",
    rich({
      type: "steps",
      title: "Set up your project",
      items: [
        "Create a workspace — Choose a short name and the folder where your files will live.",
        "Add your source notes — Bring together the references you need.",
        "Review and export — Check the final result before sharing.",
      ],
    }),
  ],
  [
    "Bento / overview cards",
    "Summarize the trip budget.",
    rich({ type: "overview", title: "Four-day trip", items }),
  ],
  [
    "Widget stacks",
    "Explain the assumptions behind the plan.",
    rich({
      type: "widgets",
      title: "Supporting details",
      items: [
        {
          label: "Travellers",
          value: "Two people",
          detail: "Sharing one room for three nights.",
        },
        {
          label: "Budget",
          value: "$715",
          detail: "Hotel, food and local travel.",
        },
        {
          label: "Timing",
          value: "Four days",
          detail: "Includes arrival and departure.",
        },
      ],
    }),
  ],
  [
    "Relationship graphs",
    "How do the systems depend on each other?",
    rich({
      type: "graph",
      title: "Request flow",
      nodes: [
        { id: "browser", label: "Browser" },
        { id: "api", label: "API server" },
        { id: "db", label: "Database" },
        { id: "cache", label: "Cache" },
      ],
      edges: [
        { from: "browser", to: "api", label: "Requests" },
        { from: "api", to: "db", label: "Reads" },
        { from: "api", to: "cache", label: "Reads" },
      ],
    }),
  ],
  [
    "File trees",
    "Show the project structure.",
    rich({
      type: "files",
      title: "Project files",
      paths: [
        "src/App.jsx",
        "src/components/Button.jsx",
        "src/components/Header.jsx",
        "src/design/tokens.css",
        "src/lib/api.js",
        "package.json",
        "README.md",
      ],
    }),
  ],
  [
    "Individual images",
    "Show the generated image.",
    "![A supplied image reference](https://example.com/design.png)",
  ],
  [
    "Image boards / masonry galleries",
    "Give me a studio inspiration board.",
    rich({ type: "gallery", title: "Studio references", images }),
  ],
  [
    "Image carousels",
    "Let me browse these rooms.",
    rich({
      type: "gallery",
      title: "Browse the rooms",
      view: "carousel",
      images,
    }),
  ],
  [
    "Image magnification / lens",
    "Inspect the architectural details.",
    rich({
      type: "gallery",
      title: "Inspect the details",
      view: "carousel",
      images: [images[0]],
    }),
  ],
  [
    "Before/after image comparisons",
    "Compare these two room photos.",
    rich({
      type: "image-compare",
      title: "A brighter workspace",
      before: images[0],
      after: images[1],
    }),
  ],
  [
    "Syntax-highlighted code blocks",
    "Write a safe total function.",
    "```javascript\nfunction total(items) {\n  if (!Array.isArray(items)) {\n    return 0;\n  }\n  return items.reduce((sum, item) => {\n    const amount = Number(item.amount);\n    return sum + (Number.isFinite(amount) ? amount : 0);\n  }, 0);\n}\n```",
  ],
  [
    "HTML / SVG previews",
    "Build a small welcome card.",
    '```html\n<div style="font-family:Georgia;padding:32px;background:#f7f2ea;color:#1c1614;border:1px solid #d6c8b2;border-radius:18px"><small>YOUR NEXT CHAPTER</small><h1 style="font-weight:400">A little room to think.</h1><p>Make space for the work that matters.</p><button style="border:0;padding:12px 18px;border-radius:8px;background:#1c1614;color:#f7f2ea">Get started</button></div>\n```',
  ],
  [
    "Code comparisons / diffs",
    "What changed between these code versions?",
    rich({
      type: "code-compare",
      title: "Safer totals",
      before:
        "function total(items) {\n  return items.reduce((sum, item) => sum + item.amount);\n}",
      after:
        "function total(items = []) {\n  return items.reduce((sum, item) => sum + item.amount, 0);\n}",
    }),
  ],
  [
    "Receipt / cost summaries",
    "Split these trip expenses between two people.",
    rich({
      type: "receipt",
      title: "Weekend expenses",
      currency: "USD",
      items: [
        { label: "Hotel", amount: 480 },
        { label: "Food", amount: 160 },
        { label: "Local travel", amount: 75 },
      ],
    }),
  ],
  [
    "QR codes",
    "I want to open the React docs on my phone.",
    rich({
      type: "qr",
      title: "Open on your phone",
      url: "https://react.dev/",
    }),
  ],
  [
    "Interactive 3D model previews",
    "Let me inspect this supplied model.",
    rich({
      type: "model",
      title: "Astronaut",
      src: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
      alt: "Astronaut model",
    }),
  ],
  [
    "Integration cards",
    "How could these systems work together?",
    rich({
      type: "integrations",
      title: "Expense workflow",
      items: [
        {
          label: "Email",
          value: "Reads receipts",
          direction: "source",
          detail: "An example source for expense records.",
        },
        {
          label: "Drive",
          value: "Stores documents",
          direction: "source",
          detail: "An example source of invoice files.",
        },
        {
          label: "Sheets",
          value: "Tracks totals",
          direction: "destination",
          detail: "A proposed destination for approved line items.",
        },
      ],
    }),
  ],
  [
    "Number / what-if explorer",
    "What if the trip costs increased by 25%?",
    "## Trip budget\n\n| Expense | Amount |\n|---|---:|\n| Hotel | $480 |\n| Food | $160 |\n| Travel | $75 |",
  ],
];
