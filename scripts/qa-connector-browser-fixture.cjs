// Isolated rendering of the actual component. No Next auth, database or business requests.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'reports', 'connector-win7');
fs.mkdirSync(out, { recursive: true });
async function main() {
  await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {UniversalWorkspaceTabs} from './components/weighbridge/universal-workspace-tabs'; createRoot(document.getElementById('root')).render(<main style={{padding:16}}><UniversalWorkspaceTabs tabs={[{id:'fixture',operationType:'harvest_incoming',primaryLabel:'Проверка подключения',secondaryLabel:'Тест без талонов',fullLabel:'Тест без данных'}]} selectedId="fixture" onSelect={()=>{}} onAdd={()=>{}} onRemove={()=>{}} onLimit={()=>{}} /></main>);`, resolveDir: root, loader: 'tsx' },
    bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(out, 'bundle.js'),
    tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
  });
  execFileSync(process.execPath, [path.join(root, 'node_modules/tailwindcss/lib/cli.js'), '-i', path.join(root, 'app/globals.css'), '-o', path.join(out, 'style.css'), '--minify'], {cwd:root,stdio:'pipe'});
  const server = http.createServer((req, res) => {
    if(req.url === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end('<!doctype html><html lang="ru" class="dark"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Connector UI QA</title><div id="root"></div><script src="/bundle.js"></script></html>'); return; }
    if(req.url === '/bundle.js' || req.url === '/style.css') { res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/css'); res.end(fs.readFileSync(path.join(out,req.url))); return; }
    if(req.url === '/favicon.ico') { res.statusCode=204;res.end();return; }
    const release = require('../public/downloads/connector-win7/release.json');
    if([release.installer.url,release.portable.url,'/downloads/connector-win7/instructions.txt'].includes(req.url)) {
      res.setHeader('Content-Type','application/octet-stream'); res.end(fs.readFileSync(path.join(root,'public',req.url))); return;
    }
    res.statusCode=404;res.end();
  });
  server.listen(8097,'127.0.0.1',()=>console.log('Connector UI QA http://127.0.0.1:8097; no business data; PID '+process.pid));
  process.stdin.on('data', () => server.close(() => process.exit(0)));
  setTimeout(()=>server.close(()=>process.exit(0)),15*60*1000).unref();
}
main().catch(e=>{ console.error(e.message);process.exit(1); });
