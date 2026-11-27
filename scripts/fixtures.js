import { writeFileSync } from 'node:fs';
import { execute } from '../core/workflow.js';

const run = await execute({ scenario: 'repair' });
const [first, broken, fixed] = run.artifacts;
const [failedReport, passedReport] = run.reports;
const examples = {
  plan: run.plan,
  buildInput: { task: run.plan.tasks[1], previous: first, scenario: 'repair' },
  verifyInput: { plan: run.plan, artifact: broken },
  repairInput: { previous: broken, report: failedReport, scenario: 'repair' },
  fixed, passedReport,
  calls: run.calls.map((c,i) => ({ ...c, id: 'sample-' + (i + 1) })),
};
writeFileSync(new URL('../fixtures/handoff.json', import.meta.url), JSON.stringify(examples,null,2) + '\n');
