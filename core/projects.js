import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, existsSync, realpathSync, statSync } from 'node:fs';
import { join, extname, isAbsolute } from 'node:path';
import { openStore } from './store.js';
import { extractWord, maxWordBytes } from './word.js';
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
  function directory(id) {
    if (!uuid.test(id)) reject('项目不存在',404);
    const link = join(root,id+'.folder.json');
    return existsSync(link) ? read(link).directory : join(root,id);
  }
  function project(id) {
    if (!uuid.test(id) || !existsSync(join(directory(id),'project.json'))) reject('项目不存在', 404);
    const info = read(join(directory(id),'project.json'));
    if (info.id !== id) reject('项目目录已变更',409);
    return info;
  }
  function thread(id, tid) {
    project(id);
    const file = join(directory(id),'chats',tid + '.json');
    if (!uuid.test(tid) || !existsSync(file)) reject('项目中没有这个对话', 404);
    return read(file);
  }
  function createThread(id, base = directory(id)) {
    const chat = { id: randomUUID(), title: '新对话', created: now(), messages: [] };
    write(join(base,'chats',chat.id + '.json'), chat);
    return chat;
  }
  function list() {
    const ids = new Set(readdirSync(root).map(name=>name.replace(/\.folder\.json$/,'' )).filter(id=>uuid.test(id)));
    return [...ids].filter(id=>existsSync(join(directory(id),'project.json')) && read(join(directory(id),'project.json')).id === id)
      .map(project).sort((a,b)=>b.created.localeCompare(a.created));
  }
  function create(name, folder) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) reject('项目名需包含 1 至 80 个字符');
    if (typeof folder !== 'string' || !isAbsolute(folder)) reject('请选择本机项目文件夹');
    let chosen;
    try {
      chosen = realpathSync(folder);
      if (!statSync(chosen).isDirectory()) reject('请选择文件夹');
    } catch { reject('项目文件夹不存在或无法访问'); }
    const base = join(chosen,'.agent-workspace');
    if (existsSync(base) || list().some(p=>directory(p.id)===chosen)) reject('此文件夹已关联项目或已有工作区，请选择其他文件夹',409);
    const id = randomUUID();
    const info = { id, name:name.trim(), created:now(), documents:[], activeDocument:null };
    try {
      // 先在所选目录准备齐全部文件，再发布固定目录和索引。
      const staging = join(chosen,'.agent-workspace-'+id);
      mkdirSync(staging);
      for (const sub of ['chats','documents','runs']) mkdirSync(join(staging,sub));
      createThread(id,staging);
      write(join(staging,'project.json'),info);
      write(join(root,id+'.folder.json'),{ directory:base });
      renameSync(staging,base);
    } catch (e) {
      if (['EPERM','EACCES','EROFS'].includes(e.code)) reject('无法写入所选文件夹或项目索引，请检查目录权限',403);
      throw e;
    }
    return info;
  }
  function detail(id) {
    const info = project(id);
    const chats = readdirSync(join(directory(id),'chats')).filter(f=>f.endsWith('.json')).map(f=>{
      const {id:chatId,title,created} = read(join(directory(id),'chats',f));
      return {id:chatId,title,created};
    }).sort((a,b)=>b.created.localeCompare(a.created));
    return { ...info, chats, directory:directory(id) };
  }
  function append(id,tid,...messages) {
    const chat = thread(id,tid);
    if (!chat.messages.length && messages[0]?.role === 'user') chat.title = messages[0].text.slice(0,30);
    chat.messages.push(...messages.map(m=>({id:randomUUID(),created:now(),...m})));
    write(join(directory(id),'chats',tid+'.json'),chat);
    return chat;
  }
  async function upload(id,{name,data}) {
    project(id);
    if (typeof name !== 'string' || name.length > 180 || /[\\/\u0000-\u001f]/.test(name) || !/\.(docx?|md|txt)$/i.test(name)) reject('请选择 Word、Markdown 或 TXT 文档');
    const word = /\.docx?$/i.test(name);
    const maxBytes = word ? maxWordBytes : limits.prd*4;
    if (typeof data !== 'string' || !data.length || data.length > Math.ceil(maxBytes/3)*4) reject('文档为空或过大');
    const bytes = Buffer.from(data,'base64');
    if (bytes.length > maxBytes || bytes.toString('base64') !== data) reject('文档编码无效');
    let content;
    if (word) content = await extractWord(bytes,extname(name).toLowerCase());
    else try { content = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { reject('请使用 UTF-8 编码'); }
    if (!content.trim() || content.includes('\0') || content.length > limits.prd) reject('PRD 需包含 1 至 32000 个文本字符');
    const doc = { id:randomUUID(),name,created:now(),size:bytes.length };
    writeFileSync(join(directory(id),'documents',doc.id + extname(name).toLowerCase()),bytes);
    if (word) writeFileSync(join(directory(id),'documents',doc.id+'.txt'),content);
    const info = project(id);
    info.documents.push(doc);
    info.activeDocument = doc.id;
    write(join(directory(id),'project.json'),info);
    return doc;
  }
  function document(id,docId,original = false) {
    const doc = project(id).documents.find(d=>d.id === docId);
    if (!doc) reject('项目中没有这份文档',404);
    const extension = extname(doc.name).toLowerCase();
    const prefix = join(directory(id),'documents',doc.id);
    if (original) return {name:doc.name,bytes:readFileSync(prefix+extension)};
    return readFileSync(prefix+(/^\.docx?$/.test(extension)?'.txt':extension),'utf8');
  }
  function runs(id) {
    project(id);
    if (!stores.has(id)) stores.set(id,openStore(join(directory(id),'runs')));
    return stores.get(id);
  }
  return { list,create,project,detail,thread,createThread,append,upload,document,runs };
}
