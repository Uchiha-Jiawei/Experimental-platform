import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { openStore } from './core/store.js';
import { execute } from './core/workflow.js';
import { validateInput, samplePrd, scenarios } from './core/contracts.js';
import { exportProduct } from './product/export.js';

const assets = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'] };
export function createServer(directory) {
  const store = openStore(directory);
  return http.createServer(async (req, res) => {
    function send(code, value, type = 'application/json') {
      res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(type === 'application/json' ? JSON.stringify(value) : value);
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      if (req.method === 'POST' && route === '/api/runs') {
        if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return send(403, { error: '来源不匹配' });
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(415, { error: '需要 JSON' });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 160000) return send(413, { error: '文档过大' });
          chunks.push(chunk);
        }
        let config;
        try { config = validateInput(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { return send(400, { error: e.message }); }
        return send(201, await execute(config, { save: store.save }));
      }
      if (req.method !== 'GET') return send(405, { error: '该操作不可用' });
      if (Object.hasOwn(assets, route)) {
        const [name, type] = assets[route];
        return send(200, readFileSync(new URL('./web/' + name, import.meta.url)), type);
      }
      if (route === '/api/config') return send(200, { samplePrd, scenarios });
      if (route === '/api/runs') return send(200, store.all().map(({id,created,status,config,used}) => ({id,created,status,scenario:config.scenario,used})));
      const match = /^\/api\/runs\/([a-f0-9-]+)(?:\/artifacts\/([0-9]+))?$/.exec(route);
      if (match) {
        const run = store.get(match[1]);
        if (run && !match[2]) return send(200, run);
        const artifact = run?.artifacts.find(a => a.version === Number(match[2]));
        if (artifact) return send(200, exportProduct(run.id, artifact), 'text/html');
      }
      send(404, { error: '资源不存在' });
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(500, { error: '运行记录读写失败或服务异常' });
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer(process.env.RUN_DIR || fileURLToPath(new URL('./.runtime/runs', import.meta.url)));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(Number(process.env.PORT || 4317), '127.0.0.1', () => console.log('工作台 http://127.0.0.1:' + server.address().port));
}
