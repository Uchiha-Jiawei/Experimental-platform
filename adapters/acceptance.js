import { createTaskList } from '../product/task-list.js';
import { schemaVersion } from '../core/contracts.js';

export function verify({ plan, artifact }) {
  // 每份产物在独立的内存存储中执行。只运行随框架发布的任务清单实现。
  const records = new Map();
  const storage = { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value) };
  const boot = () => createTaskList(artifact.features, storage);
  const app = boot();
  const title = '验收任务';
  app.add(title);
  const added = app.list();
  app.complete(0);
  const completed = app.list();
  const restored = boot().list();
  const observations = {
    'AC-1': ['新增一条任务并读取列表', added, added.some(t => t.title === title)],
    'AC-2': ['标记首条任务完成并读取状态', completed, completed[0]?.done === true],
    'AC-3': ['重新创建应用实例并读取同一存储', restored, restored.some(t => t.title === title && t.done)],
  };
  const checks = plan.criteria.map(({ id, expected }) => {
    const [steps, actual, passed] = observations[id] ?? ['未注册对应验收用例', null, false];
    return { id, expected, steps, actual, passed };
  });
  return { schemaVersion, suiteVersion: 'task-list-1', version: artifact.version, checks };
}
