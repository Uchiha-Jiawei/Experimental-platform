const el = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const labels = { passed:'已达标', budget_stop:'预算停止', repair_limit:'修复达限', clarification:'待确认', failed:'执行失败', interrupted:'已中断', running:'进行中' };
const stages = { plan:'规划', build:'开发', verify:'验收', repair:'修复' };
let config, selected, selection = 0;
async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '请求失败');
  return data;
}
function render(run) {
  selected = run.id;
  const total = run.calls.reduce((sum,c) => sum + c.input + c.output, 0);
  const last = run.reports.at(-1);
  const metric = (name,num) => '<div class="metric"><small>' + name + '</small><strong>' + escape(num) + '</strong></div>';
  const pretty = data => '<pre>' + escape(JSON.stringify(data,null,2)) + '</pre>';
  const section = (title, body, open = false) => '<details' + (open?' open':'') + '><summary>' + escape(title) + '</summary>' + body + '</details>';
  const list = entries => '<ol>' + entries.map(e => '<li>' + escape(e) + '</li>').join('') + '</ol>';
  const usage = run.calls.map(c => '<div class="row"><span>' + escape(stages[c.stage] + ' · ' + c.taskId) + '</span><span>输入 ' + c.input + ' / 输出 ' + c.output + '</span></div>').join('');
  const plan = run.plan;
  const reports = run.reports.map(r => section('v' + r.version + ' 验收证据', r.checks.map(c => '<p><b>' + escape(c.id + ' ' + (c.passed?'通过':'失败')) + '</b> · ' + escape(c.expected) + '<br>' + escape(c.steps) + '</p>' + pretty(c.actual)).join(''),r === last)).join('');
  el('result').innerHTML = '<div class="head"><h2>' + escape(config.scenarios[run.config.scenario]) + '</h2><span class="status">' + escape(labels[run.status]) + '</span></div>' +
    '<p>' + escape(run.events.at(-1).message) + '</p><div class="metrics">' + metric('模拟 Token / 预算',total + ' / ' + run.config.budget) + metric('修复轮数',run.repairs) + metric('最近验收',last ? last.checks.filter(c=>c.passed).length + ' / ' + last.checks.length : '待执行') + '</div>' +
    '<h3>执行轨迹</h3>' + list(run.events.map(e => e.message)) +
    (run.artifacts.length ? '<h3>版本产物</h3>' + run.artifacts.map(a => '<div class="row"><span>v' + a.version + ' · ' + escape(a.taskId) + '</span><a target="_blank" rel="noopener" href="/api/runs/' + run.id + '/artifacts/' + a.version + '">打开任务清单 ↗</a></div>').join('') : '') +
    reports + section('规划与任务',plan ? pretty(plan) : '<p>尚未完成规划。</p>') +
    section('Token 调用明细（模拟）', usage || '<p>尚无调用。</p>') + section('原始 PRD','<pre>' + escape(run.config.prd) + '</pre>');
  for (const b of el('history').querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.id === selected));
}
async function choose(id) {
  const ticket = ++selection;
  const run = await request('/api/runs/' + id);
  if (ticket === selection) render(run);
}
async function history() {
  const runs = await request('/api/runs');
  el('history').replaceChildren();
  for (const r of runs) {
    const button = document.createElement('button');
    button.dataset.id = r.id;
    button.setAttribute('aria-current', String(r.id === selected));
    button.textContent = new Date(r.created).toLocaleTimeString('zh-CN') + ' · ' + config.scenarios[r.scenario] + ' · ' + labels[r.status];
    button.onclick = () => choose(r.id).catch(showError);
    el('history').append(button);
  }
  if (!runs.length) el('history').textContent = '暂无运行记录';
  return runs;
}
function showError(error) { el('notice').textContent = error.message; }
el('setup').onsubmit = async event => {
  event.preventDefault();
  el('notice').textContent = '';
  el('start').disabled = true;
  try {
    const run = await request('/api/runs', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({prd:el('prd').value,scenario:el('scenario').value,budget:el('budget').valueAsNumber,maxRepairs:el('repairs').valueAsNumber}) });
    selection++;
    render(run);
    await history();
  } catch(error) { showError(error); }
  finally { el('start').disabled = false; }
};
el('scenario').onchange = () => { el('budget').value = el('scenario').value === 'budget' ? 600 : 3000; };
el('upload').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 128000) throw Error('文档过大');
    const text = await file.text();
    if (text.length > 32000) throw Error('PRD 超过 32000 字');
    el('prd').value = text;
    el('notice').textContent = '';
  } catch(error) { showError(error); }
  event.target.value = '';
};
try {
  config = await request('/api/config');
  el('prd').value = config.samplePrd;
  for (const [value,text] of Object.entries(config.scenarios)) el('scenario').add(new Option(text,value));
  el('scenario').value = 'repair';
  const runs = await history();
  if (runs.length) await choose(runs[0].id);
  el('start').disabled = false;
} catch(error) { showError(error); }
