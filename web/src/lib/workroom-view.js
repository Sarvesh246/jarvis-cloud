export const TOOL_GROUPS = {
  Verification: 'Check a result', Memory: 'Saved facts', Operations: 'Everyday tasks',
  Evaluation: 'Learn and compare', Research: 'Research and decisions',
  Privacy: 'Privacy and sharing', Planning: 'Make a plan',
};

const STATUS_TITLES = {
  completed: 'All your checks passed', partial: 'Some parts still need attention',
  failed: 'The result did not pass your checks', unverified: 'More information is needed',
  'supplied-state-satisfies-checks': 'The details match your checks',
  resolved: 'The payment details cover the refund', unresolved: 'The refund is still open',
  'expert-required': 'Ask an expert before continuing', step: 'Your next step is ready',
  'awaiting-outcome-verification': 'The steps are done. Check the outcome next',
  assessed: 'Your scores are ready to compare', 'insufficient-evidence': 'Add more results before comparing',
  'supplied-manifests-match': 'The study details you added match', 'review-required': 'There are details to review',
  'no-eligible-model': 'No AI model meets all your rules', routed: 'An AI model fits your rules',
  'human-review': 'Check what happened before trying again', 'review-needed': 'It is time to review your choice',
  'check-proposed': 'Here is a check to try next', 'no-feasible-check': 'No check fits your limits',
  'no-check-needed': 'The evidence you added supports this claim',
  'relaxation-proposed': 'A small rule change could make the plan work',
  'no-permitted-repair-within-bound': 'No plan fits the changes you allowed',
  'draft-needs-human-review': 'Your draft is ready to review', observed: 'The test result is ready',
};

export function resultOverview(output) {
  const result = output?.result || {};
  const status = result.status || output?.status;
  let title = STATUS_TITLES[status] || 'Your results are ready';
  if (result.canCutover === false || result.canProceed === false) title = 'Fix these issues before moving on';
  else if (result.canCutover === true || result.canProceed === true) title = 'The information passed these checks';
  const facts = [];
  if (result.counts) {
    facts.push(`${result.counts.passed ?? 0} checks passed`);
    if (result.counts.failed) facts.push(`${result.counts.failed} checks did not pass`);
    if (result.counts.unverified) facts.push(`${result.counts.unverified} checks need more information`);
  }
  for (const [key,label] of [['recheck','items to check again'],['pause','tasks to pause'],['compensate','finished tasks to put right'],['exceptions','differences to review'],['contradictions','conflicts found'],['alerts','changes to review'],['conflicts','edits that clash']]) {
    if (Array.isArray(result[key]) && result[key].length) facts.push(`${result[key].length} ${label}`);
  }
  if (Array.isArray(result.issues)) facts.push(...result.issues.slice(0,4));
  if (result.selected) facts.push(`Suggested model: ${result.selected}`);
  if (result.minutes !== undefined) facts.push(`${result.minutes} minutes recorded out of your ${result.limitMinutes} minute limit`);
  if (result.outstandingCents !== undefined && result.outstandingCents > 0) facts.push(`${result.outstandingCents} cents are still outstanding in the currency you chose`);
  if (result.text !== undefined && Array.isArray(result.corrections)) facts.push(`${result.corrections.length} word corrections applied`);
  return {title,facts};
}
