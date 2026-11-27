import { randomUUID } from 'node:crypto';
import { orderTasks, schemaVersion, validateInput } from './contracts.js';
import { gateway, BudgetStop } from './gateway.js';
import * as planning from '../adapters/planning.js';
import * as development from '../adapters/development.js';
import * as acceptance from '../adapters/acceptance.js';

export const defaults = { planning, development, acceptance };
export async function execute(input, { adapters = defaults, save = () => {} } = {}) {
  const config = validateInput(input);
  const run = { schemaVersion, id: randomUUID(), created: new Date().toISOString(), config, status: 'running',
    used: 0, repairs: 0, calls: [], events: [], artifacts: [], reports: [], plan: null };
  const call = gateway(run);
  function record(stage, message) {
    run.events.push({ stage, message, time: new Date().toISOString() });
    save(run);
  }
  function finish(status, message) {
    run.status = status;
    record(status, message);
    return run;
  }
  function addArtifact(candidate, taskId) {
    const { version, features } = candidate;
    if (candidate.schemaVersion !== schemaVersion || !Number.isSafeInteger(version) ||
        version <= (run.artifacts.at(-1)?.version ?? 0) ||
        ['add','complete','persist'].some(k => typeof features?.[k] !== 'boolean')) throw Error('产物版本或能力字段无效');
    run.artifacts.push(structuredClone(candidate));
    record('build', taskId + ' 已生成产物 v' + version);
  }
  record('start', '已接收产品需求文档');
  try {
    run.plan = await call('plan', 'PRD', () => adapters.planning.plan(config.prd));
    if (run.plan.questions?.length) return finish('clarification', run.plan.questions.join(' '));
    const tasks = orderTasks(run.plan);
    record('plan', '完成设计与任务拆分，共 ' + tasks.length + ' 项任务');
    for (const task of tasks) {
      const previous = run.artifacts.at(-1);
      addArtifact(await call('build', task.id, () => adapters.development.build(structuredClone({ task, previous, scenario: config.scenario }))), task.id);
    }
    while (true) {
      const previous = run.artifacts.at(-1);
      const report = await call('verify', 'v' + previous.version, () => adapters.acceptance.verify(structuredClone({ plan: run.plan, artifact: previous })));
      const checks = report.checks;
      if (report.schemaVersion !== schemaVersion || report.version !== previous.version || !Array.isArray(checks) ||
          checks.length !== run.plan.criteria.length || !run.plan.criteria.every(c => checks.some(r => r.id === c.id && typeof r.passed === 'boolean'))) {
        throw Error('验收报告与需求或产物版本不匹配');
      }
      run.reports.push(report);
      const failed = checks.filter(c => !c.passed);
      record('verify', 'v' + previous.version + ' 验收，' + failed.length + ' 项失败');
      if (!failed.length) return finish('passed', '全部验收项通过');
      if (run.repairs >= config.maxRepairs) return finish('repair_limit', '已达到修复轮数上限');
      const candidate = await call('repair', failed.map(c => c.id).join(','), () => adapters.development.repair(structuredClone({ previous, report, scenario: config.scenario })));
      run.repairs++;
      addArtifact(candidate, '修复 ' + failed.map(c => c.id).join(', '));
    }
  } catch (error) {
    return finish(error instanceof BudgetStop ? 'budget_stop' : 'failed', error.message);
  }
}
