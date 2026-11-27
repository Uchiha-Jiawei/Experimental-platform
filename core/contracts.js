import { readFileSync } from 'node:fs';

export const schemaVersion = 1;
export const samplePrd = readFileSync(new URL('../fixtures/prd.md', import.meta.url), 'utf8').trim();
export const scenarios = {
  success: '一次通过',
  repair: '缺陷修复',
  budget: '预算停止',
  stubborn: '持续失败',
};
export const limits = { prd: 32000, budget: 1000000, repairs: 10 };

export function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('需要运行配置对象');
  const { prd = samplePrd, scenario = 'repair', budget = scenario === 'budget' ? 600 : 3000, maxRepairs = 2 } = input;
  if (typeof prd !== 'string' || !prd.trim() || prd.length > limits.prd) throw Error('PRD 需包含 1 至 32000 个字符');
  if (!Object.hasOwn(scenarios, scenario) || typeof scenario !== 'string') throw Error('未知模拟场景');
  if (!Number.isInteger(budget) || budget < 0 || budget > limits.budget) throw Error('Token 预算超出范围');
  if (!Number.isInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > limits.repairs) throw Error('修复上限需为 0 至 10 的整数');
  return { prd: prd.trim(), scenario, budget, maxRepairs };
}

// 先校验完整依赖图，再把任务交给开发模块。
export function orderTasks(plan) {
  if (plan.schemaVersion !== schemaVersion || !Array.isArray(plan.tasks) || !plan.tasks.length ||
      !Array.isArray(plan.criteria) || !plan.criteria.length) throw Error('规划包缺少任务或验收条件');
  const criteria = new Set(plan.criteria.map(c => c.id));
  if (criteria.size !== plan.criteria.length || plan.criteria.some(c => !c.id || !c.expected)) throw Error('验收条件无效');
  const pending = new Map(plan.tasks.map(t => [t.id, t]));
  if (pending.size !== plan.tasks.length) throw Error('任务编号重复');
  const done = new Set();
  const covered = new Set();
  const sorted = [];
  while (pending.size) {
    const task = [...pending.values()].find(t => t.dependsOn.every(id => done.has(id)));
    if (!task) throw Error('任务依赖成环或缺少前置任务');
    if (!task.id || !task.criteria.length || task.criteria.some(id => !criteria.has(id))) throw Error('任务引用的验收项无效');
    task.criteria.forEach(id => covered.add(id));
    sorted.push(task);
    pending.delete(task.id);
    done.add(task.id);
  }
  if (covered.size !== criteria.size) throw Error('存在未覆盖的验收条件');
  return sorted;
}
