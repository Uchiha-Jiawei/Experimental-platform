import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.js';

test('项目聊天、上传、版本交付、项目隔离与重启恢复', async t=>{
  const dir=mkdtempSync(join(tmpdir(),'project-workspace-'));
  async function start(){
    const server=createServer(dir);
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const root='http://127.0.0.1:'+server.address().port;
    return {request:(path,input)=>fetch(root+path,input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),
      close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
  }
  let server=await start();t.after(()=>server.close());
  async function call(path,input){const res=await server.request(path,input);assert.ok(res.ok,await res.clone().text());return res.json();}
  assert.deepEqual(await call('/api/projects'),[]);
  assert.equal((await server.request('/api/runs',{})).status,404);
  assert.equal((await server.request('/api/projects',{name:' '})).status,400);
  assert.equal((await server.request('/api/projects',{name:'遗漏文件夹'})).status,400);
  const folder=mkdtempSync(join(tmpdir(),'测试项目-'));
  const project=await call('/api/projects',{name:'研发项目',folder});
  assert.equal((await server.request('/api/projects',{name:'重复',folder})).status,409);
  const path='/api/projects/'+project.id;
  const other='/api/projects/'+(await call('/api/projects',{name:'另一个项目',folder:mkdtempSync(join(tmpdir(),'other-project-'))})).id;
  const chat=(await call(path)).chats[0];
  const thread=path+'/chats/'+chat.id;
  assert.equal((await server.request(thread+'/runs',{prd:'注入文档'})).status,409);
  const messages=await call(thread+'/messages',{text:'先讨论项目范围'});
  assert.equal(messages.messages.length,2);
  const second=await call(path+'/chats',{});
  assert.deepEqual((await call(path+'/chats/'+second.id)).messages,[]);
  assert.equal((await server.request(other+'/chats/'+chat.id+'/messages',{text:'其他项目'})).status,404);
  const prd=readFileSync(new URL('../fixtures/prd.md',import.meta.url));
  const upload=(name,bytes)=>call(path+'/documents',{name,data:bytes.toString('base64')});
  assert.equal((await server.request(path+'/documents',{name:'../a.md',data:'YQ=='})).status,400);
  const first=await upload('我的需求.md',prd);
  assert.deepEqual(readFileSync(join(folder,'.agent-workspace','documents',first.id+'.md')),prd);
  const final=await call(thread+'/runs',{documentId:first.id,scenario:'repair'});
  const runId=final.messages.at(-1).runId;
  const run=await call(path+'/runs/'+runId);
  assert.equal(run.status,'passed');assert.equal(run.documentId,first.id);
  assert.equal(run.used,900);
  assert.match(await (await server.request(path+'/runs/'+runId+'/artifacts/3')).text(),/任务清单/);
  assert.equal((await server.request(other+'/runs/'+runId)).status,404);
  for (const ext of ['docx','doc']) {
    const original=readFileSync(new URL('./requirements.'+ext,import.meta.url));
    const word=await upload('产品需求.'+ext,original);
    const route=path+'/documents/'+word.id;
    const preview=await (await server.request(route)).text();
    assert.equal(preview.replace(/\s/g,''),prd.toString().replace(/\s/g,''));
    assert.deepEqual(Buffer.from(await (await server.request(route+'/original')).arrayBuffer()),original);
    const output=await call(thread+'/runs',{documentId:word.id});
    assert.equal((await call(path+'/runs/'+output.messages.at(-1).runId)).status,'passed');
    assert.equal((await server.request(path+'/documents',{name:'损坏.'+ext,data:'YQ=='})).status,400);
    assert.equal((await call(path)).activeDocument,word.id);
  }
  const next=await upload('我的需求.md',Buffer.from('另一份用户上传的需求'));
  assert.notEqual(first.id,next.id);
  assert.equal((await server.request(thread+'/runs',{documentId:first.id})).status,409);
  const result=await call(thread+'/runs',{});
  assert.equal((await call(path+'/runs/'+result.messages.at(-1).runId)).status,'clarification');
  assert.equal((await server.request(other+'/documents/'+first.id)).status,404);
  await server.close();server=await start();
  assert.equal((await call(path)).activeDocument,next.id);
  assert.deepEqual((await call(thread)).messages,result.messages);
  assert.equal((await call(path+'/runs/'+runId)).status,'passed');
});
