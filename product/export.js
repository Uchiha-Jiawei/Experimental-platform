import { createTaskList } from './task-list.js';

function mount(app) {
  const form = document.querySelector('form');
  const field = document.querySelector('input');
  const list = document.querySelector('ul');
  function draw() {
    list.replaceChildren();
    app.list().forEach((task, index) => {
      const item = document.createElement('li');
      item.append(task.title + ' ');
      const button = document.createElement('button');
      button.textContent = task.done ? '已完成' : '标记完成';
      button.disabled = task.done;
      button.onclick = () => { app.complete(index); draw(); };
      item.append(button);
      list.append(item);
    });
  }
  form.onsubmit = e => { e.preventDefault(); app.add(field.value); field.value = ''; draw(); };
  draw();
}

export function exportProduct(runId, artifact) {
  const { add, complete, persist } = artifact.features;
  const features = JSON.stringify({ add: !!add, complete: !!complete, persist: !!persist });
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>任务清单</title>
<style>body{font:16px/1.7 system-ui;max-width:42rem;margin:8vh auto;padding:1rem;background:#f5f8f6;color:#173c32}form,li{display:flex;align-items:center;gap:.7rem}li{justify-content:space-between;padding:10px;border-bottom:1px solid #cadbd3}ul{padding:0}input,button{font:inherit;padding:6px 10px}input{min-width:0;flex:1}button{cursor:pointer}</style>
<h1>任务清单</h1><form><input aria-label="任务名称" required placeholder="任务名称"><button>新增</button></form><ul></ul>
<script>const createTaskList = ${createTaskList.toString()};(${mount.toString()})(createTaskList(${features},localStorage,'tasks-${runId}-${artifact.version}'));</script></html>`;
}
