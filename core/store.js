import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true });
  const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
  function get(id) {
    if (!uuid.test(id)) return null;
    try { return JSON.parse(readFileSync(join(directory, id + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  function save(run) {
    const file = join(directory, run.id + '.json');
    writeFileSync(file + '.tmp', JSON.stringify(run), 'utf8');
    renameSync(file + '.tmp', file);
  }
  function all() {
    return readdirSync(directory).filter(name => name.endsWith('.json') && uuid.test(name.slice(0, -5))).map(name => get(name.slice(0, -5))).sort((a,b) => b.created.localeCompare(a.created));
  }
  // 本地单进程运行。重启后保留最后一个完整检查点。
  for (const run of all().filter(r => r.status === 'running')) {
    run.status = 'interrupted';
    run.events.push({ stage: 'interrupted', message: '服务在执行期间停止，可使用相同配置重新运行', time: new Date().toISOString() });
    save(run);
  }
  return { get, save, all };
}
