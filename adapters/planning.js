import { samplePrd, schemaVersion } from '../core/contracts.js';

const normalize = text => text.replace(/\s+/g, '');
export function plan(prd) {
  if (normalize(prd) !== normalize(samplePrd)) {
    return { schemaVersion, questions: ['当前模拟规划器仅覆盖内置任务清单 PRD。请使用演示文档，或接入一组的规划模块后重新运行。'] };
  }
  const criteria = [
    { id: 'AC-1', expected: '新增任务后列表显示该任务' },
    { id: 'AC-2', expected: '标记完成后状态为已完成' },
    { id: 'AC-3', expected: '重新加载后任务和完成状态仍存在' },
  ];
  return {
    schemaVersion, version: 'plan-1', questions: [],
    design: '单页任务清单，交互层调用任务状态模块，存储层保留任务列表。',
    criteria,
    tasks: [
      { id: 'T-1', title: '新增与完成任务', dependsOn: [], criteria: ['AC-1', 'AC-2'] },
      { id: 'T-2', title: '保存与恢复任务', dependsOn: ['T-1'], criteria: ['AC-3'] },
    ],
  };
}
