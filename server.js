import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { openStore } from './core/store.js';
import { openProjects, reject } from './core/projects.js';
import { execute } from './core/workflow.js';
import { validateInput, scenarios } from './core/contracts.js';
import { exportProduct } from './product/export.js';

import { pickFolder } from './core/folder-picker.js';
import { maxWordBytes } from './core/word.js';

const assets = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'] };
async function body(req, maxBytes = 200000) {
  if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) reject('来源不匹配',403);
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') reject('需要 JSON',415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) reject('内容过大',413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString()); } catch { reject('JSON 格式错误'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('需要 JSON 对象');
  return value;
}

function answer(text, project, chat, projects) {
  const doc = project.documents.find(d=>d.id === project.activeDocument);
  const last = chat.messages.findLast(m=>m.runId);
  const run = last && projects.runs(project.id).get(last.runId);
  if (/预算|token|用量|消耗/i.test(text) && run) return '最近一次模拟运行使用了 ' + run.used + ' / ' + run.config.budget + ' Token。详细记录见本对话的运行结果。';
  if (/验收|进度|结果|状态/.test(text) && run) return run.events.at(-1).message + '。已执行 ' + run.repairs + ' 轮修复。';
  if (/需求|文档|PRD/i.test(text) && doc) return '当前需求文档《' + doc.name + '》\n\n' + projects.document(project.id,doc.id).slice(0,800);
  return doc ? '已将这条消息保存到项目「' + project.name + '」。当前为本地模拟助手，可查看需求文档、查询最近的验收与用量，或点击“运行项目”执行模拟流程。'
    : '已保存到项目「' + project.name + '」。可以继续记录想法，上传 PRD 后即可运行项目。';
}

export function createServer(directory, legacyDirectory) {
  const projects = openProjects(directory);
  const legacy = legacyDirectory && openStore(legacyDirectory);
  return http.createServer(async (req,res)=>{
    function send(code,value,type='application/json') {
      res.writeHead(code,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(type === 'application/json' ? JSON.stringify(value) : value);
    }
    try {
      const route = new URL(req.url,'http://localhost').pathname;
      const get = req.method === 'GET';
      const post = req.method === 'POST';
      if (get && Object.hasOwn(assets,route)) {
        const [name,type] = assets[route];
        return send(200,readFileSync(new URL('./web/'+name,import.meta.url)),type);
      }
      if (get && route === '/api/config') return send(200,{scenarios});
      const [,api,scope,id,kind,item,action,version] = route.split('/');
      if (api !== 'api') reject('资源不存在',404);
      if (scope === 'runs' && get && legacy) {
        if (!id) return send(200,legacy.all().map(({id,created,status,used})=>({id,created,status,used})));
        const run = legacy.get(id);
        if (run && !kind) return send(200,run);
        const artifact = kind === 'artifacts' && run?.artifacts.find(a=>a.version === Number(item));
        if (artifact) return send(200,exportProduct(id,artifact),'text/html');
      }
      if (post && route === '/api/select-folder') {
        await body(req);
        return send(200,await pickFolder());
      }
      if (scope !== 'projects') reject('请在项目中操作',404);
      if (!id && get) return send(200,projects.list());
      if (!id && post) {
        const {name,folder} = await body(req);
        return send(201,projects.create(name,folder));
      }
      const input = post ? await body(req,kind==='documents' && !item ? Math.ceil(maxWordBytes/3)*4+2048 : undefined) : {};
      const project = projects.project(id);
      if (get && !kind) return send(200,projects.detail(id));
      if (kind === 'documents') {
        if (post && !item) return send(201,await projects.upload(id,input));
        if (get && item && action==='original') {
          const {name,bytes} = projects.document(id,item,true);
          res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store',
            'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name)});
          return res.end(bytes);
        }
        if (get && item) return send(200,projects.document(id,item),'text/plain');
      }
      if (kind === 'chats') {
        if (post && !item) return send(201,projects.createThread(id));
        const chat = projects.thread(id,item || '');
        if (get && !action) return send(200,chat);
        if (post && action === 'messages') {
          if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 16000) reject('消息需包含 1 至 16000 个字符');
          const text = input.text.trim();
          return send(201,projects.append(id,item,{role:'user',text},{role:'assistant',text:answer(text,project,chat,projects)}));
        }
        if (post && action === 'runs') {
          if (!project.activeDocument) reject('请先上传项目需求文档',409);
          if (input.documentId && input.documentId !== project.activeDocument) reject('当前 PRD 已更新，请刷新项目后重试',409);
          const doc = project.documents.find(d=>d.id === project.activeDocument);
          let config;
          try { config = validateInput({...input,prd:projects.document(id,doc.id)}); } catch(e) { reject(e.message); }
          const store = projects.runs(id);
          await execute(config,{save:run=>{
            const first = run.events.length === 1;
            store.save({...run,chatId:item,documentId:doc.id});
            if (first) projects.append(id,item,{role:'user',text:'运行项目 · '+doc.name},{role:'assistant',text:'项目运行',runId:run.id});
          }});
          return send(201,projects.thread(id,item));
        }
      }
      if (get && kind === 'runs') {
        const run = projects.runs(id).get(item || '');
        if (run && !action) return send(200,run);
        const artifact = action === 'artifacts' && run?.artifacts.find(a=>a.version === Number(version));
        if (artifact) return send(200,exportProduct(run.id,artifact),'text/html');
      }
      reject('资源不存在',404);
    } catch(e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(e.status || 500,{error:e.status ? e.message : '服务异常，请重试'});
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer(process.env.PROJECTS_DIR || fileURLToPath(new URL('./projects',import.meta.url)),
    process.env.RUN_DIR || fileURLToPath(new URL('./.runtime/runs',import.meta.url)));
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(Number(process.env.PORT || 4317),'127.0.0.1',()=>console.log('项目工作台 http://127.0.0.1:'+server.address().port));
}
