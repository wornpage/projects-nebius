import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

const port = await availablePort();
let inspectorPort;
do { inspectorPort = await availablePort(); } while (inspectorPort === port);
const origin = `http://127.0.0.1:${port}`;
// Always local and disabled: this gate proves startup and routing without
// reading a saved task, requesting inference, or deploying any resource.
const worker = spawn(process.execPath, [
  path.resolve('node_modules/wrangler/bin/wrangler.js'), 'dev', '--local',
  '--config', 'wrangler.nebius.jsonc', '--ip', '127.0.0.1', '--port', String(port),
  '--inspector-ip', '127.0.0.1', '--inspector-port', String(inspectorPort),
  '--var', 'NEBIUS_ENABLED:false',
], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
let log = '', launchError;
worker.on('error', error => { launchError = error; });
for (const stream of [worker.stdout, worker.stderr]) stream.on('data', chunk => { log = (log + chunk.toString()).slice(-16000); });

try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error(`Local Worker exited before startup.\n${log}`);
    try {
      const response = await fetch(`${origin}/api/nebius/config?operation=suggest-next-step`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 404 && (await response.json()).code === 'nebius_disabled') { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, `Local Worker did not start within 30 seconds.\n${log}`);
  const landing = await fetch(origin, { signal: AbortSignal.timeout(5000) });
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /id="nebius-title"/u);
  const next = await fetch(`${origin}/next?pack=nebius-keyboard-review`, { signal: AbortSignal.timeout(5000) });
  assert.equal(next.status, 200);
  assert.match(await next.text(), /Next step/u);
  for (const operation of ['suggest-next-step', 'review-evidence', 'plan-project', 'replan-project']) {
    const response = await fetch(`${origin}/api/nebius/${operation}`, {
      method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json', origin }, body: '{}',
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'nebius_disabled');
  }
  console.log(JSON.stringify({ localWorkerdStarted: true, nebiusLanding: 200, selectedTaskRoute: 200, disabledOperations: 4, inferenceCalls: 0, deployed: false }));
} finally {
  if (worker.exitCode === null && worker.signalCode === null && worker.pid) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(worker.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    } else {
      worker.kill('SIGTERM');
      await Promise.race([new Promise(resolve => worker.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (worker.exitCode === null) worker.kill('SIGKILL');
    }
  }
}
