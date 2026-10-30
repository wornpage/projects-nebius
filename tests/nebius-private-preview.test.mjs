import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));

test('private preview serves disabled configuration while refusing every mutation', async t => {
  const tempBase = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(tempBase, 'nebius-private-preview-'));
  const rootReal = await fs.realpath(root);
  assert.equal(path.dirname(rootReal).toLowerCase(), tempBase.toLowerCase());
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'exit');
      child.kill();
      await closed;
    }
    assert.equal(path.dirname(await fs.realpath(root)).toLowerCase(), tempBase.toLowerCase());
    await fs.rm(root, { recursive: true, force: false });
  });
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.mkdir(path.join(root, 'dist', 'static-publish'), { recursive: true });
  await fs.writeFile(path.join(root, 'dist', 'static-publish', 'index.html'), '<!doctype html><title>Preview transport fixture</title>');
  await fs.copyFile(path.join(repo, 'scripts/private-recovery-preview.mjs'), path.join(root, 'scripts/private-recovery-preview.mjs'));
  await fs.symlink(path.join(repo, 'worker'), path.join(root, 'worker'), process.platform === 'win32' ? 'junction' : 'dir');
  // Deliberately enabled-looking fake values must not activate this server.
  const env = { ...process.env, NEBIUS_ENABLED: 'true', NEBIUS_EXECUTION_ENABLED: 'true', NEBIUS_API_KEY: 'test-only-not-a-key', NEBIUS_SANDBOX_TOKEN: 'test-only-not-a-token' };
  child = spawn(process.execPath, [path.join(root, 'scripts/private-recovery-preview.mjs')], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview startup timed out: ' + stderr)), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited ${code}: ${stderr}`)); });
    child.stdout.on('data', data => {
      stdout += data;
      const line = stdout.split('\n').find(value => value.startsWith('{'));
      if (!line) return;
      try { const value = JSON.parse(line); clearTimeout(timer); resolve(value); } catch {}
    });
  });
  assert.match(info.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
  const request = (pathname, method = 'GET', host) => new Promise((resolve, reject) => {
    const target = new URL(pathname, info.origin);
    const req = http.request(target, { method, headers: host ? { host } : {} }, res => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', data => { body += data; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.once('error', reject); req.end();
  });
  for (const operation of ['suggest-next-step', 'review-evidence', 'plan-project', 'replan-project']) {
    const response = await request('/api/nebius/config?operation=' + operation);
    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(response.body), { available: false, code: 'nebius_disabled' });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const execution = await request('/api/nebius/runs/config');
  assert.equal(execution.status, 404);
  assert.deepEqual(JSON.parse(execution.body), { available: false, code: 'execution_disabled', error: 'AI builds are disabled in this offline preview.' });
  for (const pathname of ['/api/nebius/config', '/api/nebius/runs/config']) {
    const head = await request(pathname, 'HEAD'); assert.equal(head.status, 404); assert.equal(head.body, '');
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const pathname of ['/api/nebius/runs/config', '/api/nebius/runs/00000000-0000-4000-8000-000000000000', '/api/nebius/suggest-next-step']) {
      const response = await request(pathname, method); assert.equal(response.status, 405); assert.equal(response.headers.allow, 'GET, HEAD');
    }
  }
  assert.equal((await request('/api/nebius/runs/config', 'GET', 'external.invalid')).status, 400);
  assert.equal((await request('/api/unavailable')).status, 503);
  assert.equal((await request('/')).status, 200);
  assert.equal(await fs.access(path.join(root, '.dev.vars')).then(() => true, () => false), false);
});
