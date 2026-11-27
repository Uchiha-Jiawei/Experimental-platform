export class BudgetStop extends Error {}

// 固定模拟用量用于可复现的预算和对账测试。
const usage = { plan: [120, 80], build: [100, 80], verify: [65, 35], repair: [90, 50] };
export function gateway(run) {
  return function call(stage, taskId, action) {
    const [input, output] = usage[stage];
    if (run.used + input + output > run.config.budget) throw new BudgetStop('剩余预算不足以执行下一次' + stage + '调用');
    run.calls.push({ id: run.id + '-' + (run.calls.length + 1), stage, taskId, model: 'mock-v1', source: '模拟', input, output });
    run.used += input + output;
    return action();
  };
}
