import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRecoveryExample, isRecoveryExamplePath } from '../worker/nebius-recovery-example.mjs';
import { handleRecordedExample, RECORDED_EXAMPLE_PATH } from '../worker/nebius-recorded-example.mjs';
const root = path.resolve(fileURLToPath(new URL('../dist/static-publish/', import.meta.url)));
const artifact = await fs.realpath(root);
const recordIndex = process.argv.indexOf('--record');
const receipt = recordIndex < 0 ? null : process.argv[recordIndex + 1];
if (recordIndex >= 0 && (!receipt || !path.isAbsolute(receipt))) throw new Error('--record requires an absolute local file path.');
const portIndex = process.argv.indexOf('--port');
const portText = portIndex < 0 ? '0' : process.argv[portIndex + 1];
if (typeof portText !== 'string' || !/^\d{1,5}$/u.test(portText) || Number(portText) > 65535) throw new Error('--port requires a local port from 0 to 65535.');
const port = Number(portText);
const mime = { '.html':'text/html;charset=utf-8', '.js':'text/javascript;charset=utf-8', '.css':'text/css;charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain;charset=utf-8', '.webmanifest':'application/manifest+json' };
// The local preview cannot call a provider even if the parent shell has credentials.
globalThis.fetch = async () => { throw new Error('Outbound requests are disabled in the private recovery preview.'); };
const server = http.createServer(async (req, res) => {
  try {
    const local = `127.0.0.1:${server.address().port}`;
    if (req.headers.host !== local) { res.writeHead(400); res.end('Local host only.'); return; }
    const url = new URL(req.url, `http://${local}`);
    if (![ 'GET', 'HEAD' ].includes(req.method)) { res.writeHead(405, { allow:'GET, HEAD' }); res.end('Read-only preview.'); return; }
    if (isRecoveryExamplePath(url.pathname)) {
      const response = await handleRecoveryExample(new Request(url, { method:req.method }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (url.pathname === RECORDED_EXAMPLE_PATH) {
      const response = await handleRecordedExample(new Request(url, { method:req.method }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    // Use the existing clients' disabled-configuration protocol. This preview
    // never reads provider settings or credentials from the host environment.
    if (url.pathname === '/api/nebius/config' || url.pathname === '/api/nebius/runs/config') {
      const body = url.pathname === '/api/nebius/runs/config'
        ? { available: false, code: 'execution_disabled', error: 'AI builds are disabled in this offline preview.' }
        : { available: false, code: 'nebius_disabled' };
      res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body)); return;
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(503, { 'content-type':'application/json', 'cache-control':'no-store' }); res.end(JSON.stringify({ available:false, error:'AI is disabled in this private offline preview.' })); return; }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.resolve(root, path.extname(relative) ? relative : relative + '.html');
    if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
    let resolved;
    try { resolved = await fs.realpath(target); } catch { res.writeHead(404); res.end('Not found.'); return; }
    if (!resolved.startsWith(artifact + path.sep)) { res.writeHead(404); res.end(); return; }
    const bytes = await fs.readFile(resolved);
    res.writeHead(200, { 'content-type':mime[path.extname(resolved)] || 'application/octet-stream', 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'x-robots-tag':'noindex, nofollow', 'referrer-policy':'no-referrer' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(500); res.end('Private preview unavailable.'); }
});
server.listen(port,'127.0.0.1',async () => {
  const address = server.address();
  const info = { pid:process.pid, origin:`http://127.0.0.1:${address.port}`, url:`http://127.0.0.1:${address.port}/recovery-rehearsal`, artifact, noPaidCalls:true, noOwnerCredentialsOrState:true, startedAt:new Date().toISOString() };
  if (receipt) await fs.writeFile(receipt,JSON.stringify(info,null,2),{flag:'wx'});
  console.log(JSON.stringify(info));
});
