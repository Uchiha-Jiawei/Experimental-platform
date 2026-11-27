import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { openStore } from './store.js';
import { limits } from './contracts.js';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export function reject(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function write(file, value) {
  writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  renameSync(file + '.tmp', file);
}
function read(file) { return JSON.parse(readFileSync(file, 'utf8')); }
const now = () => new Date().toISOString();

export function openProjects(root) {
  mkdirSync(root, { recursive: true });
  const stores = new Map();
  function project(id) {
    if (!uuid.test(id) || !existsSync(join(root,id,'project.json'))) reject('项目不存在', 404);
    return read(join(root,id,'project.json'));
  }
  function thread(id, tid) {
    project(id);
    const file = join(root,id,'chats',tid + '.json');
    if (!uuid.test(tid) || !existsSync(file)) reject('项目中没有这个对话', 404);
    return read(file);
  }
  function createThread(id) {
    const chat = { id: randomUUID(), title: '新对话', created: now(), messages: [] };
    write(join(root,id,'chats',chat.id + '.json'), chat);
    return chat;
  }
  function list() {
    return readdirSync(root,{ withFileTypes:true }).filter(d => d.isDirectory() && uuid.test(d.name) && existsSync(join(root,d.name,'project.json')))
      .map(d => project(d.name)).sort((a,b) => b.created.localeCompare(a.created));
  }
  function create(name) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) reject('项目名需包含 1 至 80 个字符');
    const id = randomUUID();
    for (const sub of ['chats','documents','runs']) mkdirSync(join(root,id,sub),{ recursive:true });
    const info = { id, name:name.trim(), created:now(), documents:[], activeDocument:null };
    createThread(id);
    write(join(root,id,'project.json'), info);
    return info;
  }
  function detail(id) {
    const info = project(id);
    const chats = readdirSync(join(root,id,'chats')).filter(f=>f.endsWith('.json')).map(f=>{
      const {id:chatId,title,created} = read(join(root,id,'chats',f));
      return {id:chatId,title,created};
    }).sort((a,b)=>b.created.localeCompare(a.created));
    return { ...info, chats, directory:join(root,id) };
  }
  function append(id,tid,...messages) {
    const chat = thread(id,tid);
    if (!chat.messages.length && messages[0]?.role === 'user') chat.title = messages[0].text.slice(0,30);
    chat.messages.push(...messages.map(m=>({id:randomUUID(),created:now(),...m})));
    write(join(root,id,'chats',tid+'.json'),chat);
    return chat;
  }
  function upload(id,{name,data}) {
    const info = project(id);
    if (typeof name !== 'string' || name.length > 180 || /[\\/\u0000-\u001f]/.test(name) || !/\.(md|txt)$/i.test(name)) reject('请选择 Markdown 或 TXT 文档');
    if (typeof data !== 'string' || !data.length || data.length > 180000) reject('文档为空或过大');
    const bytes = Buffer.from(data,'base64');
    if (bytes.toString('base64') !== data) reject('文档编码无效');
    let content;
    try { content = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { reject('请使用 UTF-8 编码'); }
    if (!content.trim() || content.includes('\0') || content.length > limits.prd) reject('PRD 需包含 1 至 32000 个文本字符');
    const doc = { id:randomUUID(),name,created:now(),size:bytes.length };
    writeFileSync(join(root,id,'documents',doc.id + extname(name).toLowerCase()),bytes);
    info.documents.push(doc);
    info.activeDocument = doc.id;
    write(join(root,id,'project.json'),info);
    return doc;
  }
  function document(id,docId) {
    const doc = project(id).documents.find(d=>d.id === docId);
    if (!doc) reject('项目中没有这份文档',404);
    return readFileSync(join(root,id,'documents',doc.id + extname(doc.name).toLowerCase()),'utf8');
  }
  function runs(id) {
    project(id);
    if (!stores.has(id)) stores.set(id,openStore(join(root,id,'runs')));
    return stores.get(id);
  }
  return { list,create,project,detail,thread,createThread,append,upload,document,runs };
}
