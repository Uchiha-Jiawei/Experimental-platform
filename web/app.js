const $ = id => document.getElementById(id);
const esc = v => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses = {passed:'验收通过',budget_stop:'预算停止',repair_limit:'修复达限',clarification:'需求待确认',failed:'执行失败',running:'运行中',interrupted:'运行中断'};
const stageNames = {plan:'规划',build:'开发',verify:'验收',repair:'修复'};
let projects=[], project=null, chat=null, results=new Map(), busy=false, noticeTimer;
const base = () => '/api/projects/'+project.id;
const chatUrl = () => base()+'/chats/'+chat.id;
async function api(path,value) {
  const options = value === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)};
  const res = await fetch(path,options);
  const data = await res.json();
  if (!res.ok) throw Error(data.error || '请求失败');
  return data;
}
function notice(message) {
  if (document.querySelector('dialog[open]')) {
    const dialog = document.querySelector('dialog[open]');
    let error = dialog.querySelector('[role="alert"]');
    if (!error) { error=document.createElement('p');error.setAttribute('role','alert');dialog.append(error); }
    error.textContent=message;
    return;
  }
  $('notice').textContent=message; $('notice').hidden=false;
  clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>$('notice').hidden=true,5000);
}
async function act(work) {
  if (busy) return;
  busy=true;
  for(const node of [$('shell'),...document.querySelectorAll('dialog[open]')]) node.inert=true;
  try { await work(); } catch(e) {notice(e.message);}
  finally {busy=false;for(const node of [$('shell'),...document.querySelectorAll('dialog')]) node.inert=false;}
}
function nav(open) { document.body.classList.toggle('navOpen',open); $('scrim').hidden=!open; }
function showDialog(id) { const dialog=$(id);dialog.querySelector('[role="alert"]')?.remove();dialog.showModal(); }
function row(title,id,active,folder,select) {
  const b=document.createElement('button'); b.className='navRow';
  b.setAttribute('aria-current',String(id===active));b.title=title;
  b.innerHTML='<span aria-hidden="true" class="glyph '+(folder?'folder':'')+'">'+(folder?'':'◌')+'</span><span>'+esc(title)+'</span>';
  b.onclick=()=>act(select);return b;
}
function runView(run) {
  const detail=(title,body)=>'<details><summary>'+esc(title)+'</summary>'+body+'</details>';
  const pre=value=>'<pre>'+esc(value)+'</pre>';
  return '<div class="result"><b>'+esc(statuses[run.status]||run.status)+'</b>　<small>'+run.used+' 模拟 Token · '+run.repairs+' 轮修复</small><br>'+esc(run.events.at(-1).message)+
    detail('执行记录',pre(run.events.map(e=>e.message).join('\n')))+
    (run.plan ? detail('规划与任务',pre(JSON.stringify(run.plan,null,2))) : '')+
    run.reports.map(r=>detail('v'+r.version+' 验收证据',pre(r.checks.map(c=>c.id+' '+(c.passed?'通过':'失败')+' · '+c.expected+'\n'+c.steps+' → '+JSON.stringify(c.actual)).join('\n')))).join('')+
    detail('Token 明细',pre(run.calls.map(c=>stageNames[c.stage]+' · '+c.taskId+'　输入 '+c.input+' / 输出 '+c.output).join('\n')||'暂无调用'))+
    run.artifacts.map(a=>'<a target="_blank" rel="noopener" href="'+base()+'/runs/'+run.id+'/artifacts/'+a.version+'">打开 v'+a.version+'</a>').join('')+'</div>';
}
function draw() {
  $('projects').replaceChildren(...projects.map(p=>row(p.name,p.id,project?.id,true,()=>select(p.id))));
  if (!projects.length) $('projects').innerHTML='<div class="emptyNav">暂无项目</div>';
  $('threads').hidden=!project; $('showFiles').hidden=!project; $('composeWrap').hidden=!chat;
  $('crumb').textContent=project?project.name+'　/　'+chat.title:'工作区';
  $('chats').replaceChildren(...(project?.chats||[]).map(c=>row(c.title,c.id,chat?.id,false,()=>select(project.id,c.id))));
  const hasMessages=Boolean(chat?.messages.length);
  $('messages').hidden=!hasMessages;$('welcome').hidden=hasMessages;
  $('welcome').querySelector('h1').textContent=project?'从哪里开始？':'从一个项目开始';
  $('welcome').querySelector('p').textContent=project?'在「'+project.name+'」中讨论需求，或上传 PRD 开始运行。':'创建项目，把需求文档、对话和交付记录放在一起。';
  $('welcome').querySelector('button').hidden=!!project;
  const doc=project?.documents.find(d=>d.id===project.activeDocument);
  $('runBtn').disabled=!doc;$('runBtn').title=doc?'配置模拟运行':'请先上传需求文档';
  $('docStatus').textContent=doc?doc.name:'尚未上传 PRD';
  $('sendBtn').disabled=!$('message').value.trim();
  $('messages').innerHTML=(chat?.messages||[]).map(m=>{
    const user=m.role==='user';
    return '<article class="msg '+(user?'user':'')+'" aria-label="'+(user?'你':'项目助手')+'">'+(user?'':'<div class="agentLabel"><span class="agentIcon" aria-hidden="true">›_</span>项目助手</div>')+
      (m.runId && results.has(m.runId)?runView(results.get(m.runId)):'<div class="messageText">'+esc(m.text)+'</div>')+'</article>';
  }).join('');
  $('stream').scrollTop=$('stream').scrollHeight;
}
async function select(id,tid) {
  const p=await api('/api/projects/'+id);
  const target=p.chats.find(c=>c.id===tid)||p.chats[0];
  const c=await api('/api/projects/'+id+'/chats/'+target.id);
  const runs=await Promise.all(c.messages.filter(m=>m.runId).map(async m=>[m.runId,await api('/api/projects/'+id+'/runs/'+m.runId)]));
  if(chat?.id!==c.id) $('message').value='';
  project=p;chat=c;results=new Map(runs);
  history.replaceState(null,'','#'+id+'/'+c.id);
  nav(false);draw();
}
for(const btn of document.querySelectorAll('[data-create]')) btn.onclick=()=>{$('projectName').value='';showDialog('createDialog');$('projectName').focus();};
for(const btn of document.querySelectorAll('[data-close]')) btn.onclick=()=>btn.closest('dialog').close();
$('openNav').onclick=()=>nav(true);$('closeNav').onclick=$('scrim').onclick=()=>nav(false);
document.addEventListener('keydown',e=>{if(e.key==='Escape')nav(false);});
$('projectForm').onsubmit=e=>{e.preventDefault();act(async()=>{
  const p=await api('/api/projects',{name:$('projectName').value});projects=await api('/api/projects');await select(p.id);
  $('createDialog').close();$('message').focus();
});};
$('newChat').onclick=()=>act(async()=>{const c=await api(base()+'/chats',{});await select(project.id,c.id);});
$('composer').onsubmit=e=>{e.preventDefault();act(async()=>{
  if(!chat || !$('message').value.trim()) return;
  await api(chatUrl()+'/messages',{text:$('message').value});$('message').value='';await select(project.id,chat.id);
});};
$('message').oninput=()=>$('sendBtn').disabled=!$('message').value.trim();
$('message').onkeydown=e=>{if(e.key==='Enter' && !e.shiftKey && !e.isComposing && e.keyCode!==229){e.preventDefault();$('composer').requestSubmit();}};
function files() {
  $('directory').textContent=project.directory;
  $('documents').innerHTML=project.documents.length?project.documents.map(d=>'<p><a target="_blank" rel="noopener" href="'+base()+'/documents/'+d.id+'">'+esc(d.name)+'</a> '+(d.id===project.activeDocument?' · 当前 PRD':'')+'</p>').join(''):'尚未上传文档。支持 UTF-8 的 .md 和 .txt 文件。';
}
$('showFiles').onclick=()=>{files();showDialog('filesDialog');};
let uploadProject;
$('uploadBtn').onclick=$('fileUpload').onclick=()=>{uploadProject=project.id;$('upload').click();};
$('upload').onchange=()=>act(async()=>{
  const f=$('upload').files[0];$('upload').value='';
  if(!f || project?.id!==uploadProject) return;
  if(f.size>128000) throw Error('文件过大，最多支持 32000 个文本字符');
  const bytes=new Uint8Array(await f.arrayBuffer());
  let binary='';for(const byte of bytes) binary+=String.fromCharCode(byte);
  await api(base()+'/documents',{name:f.name,data:btoa(binary)});await select(project.id,chat.id);
  if($('filesDialog').open) files();else notice('已保存 '+f.name);
});
$('runBtn').onclick=()=>{$('runDoc').textContent='使用 '+project.documents.find(d=>d.id===project.activeDocument).name;showDialog('runDialog');};
$('scenario').onchange=()=>{$('budget').value=$('scenario').value==='budget'?600:3000;};
$('runForm').onsubmit=e=>{e.preventDefault();act(async()=>{
  await api(chatUrl()+'/runs',{documentId:project.activeDocument,scenario:$('scenario').value,budget:$('budget').valueAsNumber,maxRepairs:$('repairs').valueAsNumber});
  await select(project.id,chat.id);$('runDialog').close();
});};
await act(async()=>{
  const [config,list]=await Promise.all([api('/api/config'),api('/api/projects')]);projects=list;
  for(const [value,label] of Object.entries(config.scenarios)) $('scenario').add(new Option(label,value));
  $('scenario').value='repair';
  const [id,tid]=location.hash.slice(1).split('/');
  if(projects.some(p=>p.id===id)) await select(id,tid);
  else if(projects.length) await select(projects[0].id);
  else draw();
});
