import { schemaVersion } from '../core/contracts.js';

export function build({ task, previous, scenario }) {
  const features = { add: false, complete: false, persist: false, ...previous?.features };
  if (task.id === 'T-1') Object.assign(features, { add: true, complete: true });
  else if (task.id === 'T-2') features.persist = !['repair', 'stubborn'].includes(scenario);
  else throw Error('模拟开发器无法处理任务 ' + task.id);
  return { schemaVersion, version: (previous?.version ?? 0) + 1, taskId: task.id, features };
}

export function repair({ previous, report, scenario }) {
  if (report.version !== previous.version) throw Error('缺陷单与产物版本不匹配');
  const features = { ...previous.features };
  for (const check of report.checks.filter(c => !c.passed)) {
    if (check.id === 'AC-3' && scenario !== 'stubborn') features.persist = true;
  }
  return { schemaVersion, version: previous.version + 1, taskId: 'repair', parentVersion: previous.version, features };
}
