// Synthetic messages only; shared by the browser regression and visual review.
export const longEditableMessage = Array.from({ length: 100 }, (_, index) =>
  `${index + 1}. Keep this line intact: café, 日本語, مرحبا, 👩🏽‍💻.`,
).join('\n');

export const editingFixtures = [
  { id: 'short', content: 'Please explain this example.' },
  { id: 'long', content: longEditableMessage, priorTurns: 40 },
  { id: 'unbroken', content: 'identifier_'.repeat(700) },
  { id: 'rtl', content: 'مرحبا بالعالم\n'.repeat(80) },
];
