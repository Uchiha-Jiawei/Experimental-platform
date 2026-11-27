import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute, defaults } from '../core/workflow.js';
import { orderTasks } from '../core/contracts.js';
import { openStore } from '../core/store.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/handoff.json', import.meta.url)));
for (const [scenario, status, used, repairs] of [
  ['success','passed',660,0], ['repair','passed',900,1], ['budget','budget_stop',560,0], ['stubborn','repair_limit',1140,2]
]) {
  test('端到端场景 ' + scenario, async () => {
    const run = await execute({ scenario });
    assert.deepEqual([run.status,run.used,run.repairs],[status,used,repairs]);
    assert.equal(run.used, run.calls.reduce((n,c) => n + c.input + c.output,0));
    assert.equal(new Set(run.calls.map(c => c.id)).size,run.calls.length);
    if (repairs) assert.equal(run.reports[0].checks.at(-1).passed,false);
    if (status === 'passed') assert.ok(run.reports.at(-1).checks.every(c => c.passed));
  });
}
test('预算边界、未知需求、修复上限', async () => {
  assert.equal((await execute({ budget:0 })).calls.length,0);
  assert.equal((await execute({ budget:660,scenario:'success' })).status,'passed');
  assert.equal((await execute({ prd:'做一个博客' })).status,'clarification');
  assert.equal((await execute({ maxRepairs:0 })).status,'repair_limit');
});
test('三个模块独立消费交接样例', async () => {
  assert.deepEqual(defaults.development.build(fixtures.buildInput),fixtures.verifyInput.artifact);
  assert.deepEqual(defaults.acceptance.verify(fixtures.verifyInput),fixtures.repairInput.report);
  assert.deepEqual(defaults.development.repair(fixtures.repairInput),fixtures.fixed);
  assert.deepEqual(defaults.acceptance.verify({plan:fixtures.plan,artifact:fixtures.fixed}),fixtures.passedReport);
});
test('依赖错误或验收记录缺失不能交付', async () => {
  const plan = structuredClone(fixtures.plan);
  plan.tasks[0].dependsOn.push('T-2');
  assert.throws(() => orderTasks(plan),/依赖/);
  const acceptance = { verify: () => ({schemaVersion:1,version:2,checks:[]}) };
  assert.equal((await execute({}, {adapters:{...defaults,acceptance}})).status,'failed');
});
test('持久化与启动中断恢复', async () => {
  const dir = mkdtempSync(join(tmpdir(),'agent-store-'));
  const store = openStore(dir);
  const run = await execute({}, {save:store.save});
  assert.deepEqual(openStore(dir).get(run.id),run);
  store.save({...run,status:'running'});
  assert.equal(openStore(dir).get(run.id).status,'interrupted');
});
test('单组替换为异步适配器后仍可完成联调', async () => {
  const planning = { plan: async () => structuredClone(fixtures.plan) };
  const run = await execute({}, { adapters: { ...defaults, planning } });
  assert.equal(run.status, 'passed');
  assert.equal(run.repairs, 1);
});
