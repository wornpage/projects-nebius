import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

const nebiusEdition = process.argv.includes('--nebius');
const port = 4179;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.resolve('svelte-frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: 'svelte-frontend', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PROJECTS_NEBIUS_EDITION: String(nebiusEdition) } });
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-4000); });
server.stderr.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-4000); });
let browser;

try {
	let ready = false;
	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Owned preview exited before readiness: ${serverOutput}`);
		try { if (serverOutput.includes(origin) && (await fetch(`${origin}/webmcp-challenge`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	assert.equal(ready, true, `Owned preview did not become ready: ${serverOutput}`);
	browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
	const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
	await page.goto(`${origin}/webmcp-challenge`, { waitUntil: 'networkidle' });
	await page.evaluate(async () => {
		const seed = await (await fetch('/data/demo-packs.json')).json();
		localStorage.setItem('projects-webmcp-challenge-state-v1', JSON.stringify({ packs: seed, manualOrder: seed.map((pack) => pack.id).reverse(), pendingNextActionDrafts: [] }));
	});
	await page.reload({ waitUntil: 'networkidle' });
	await page.locator('summary, button').filter({ hasText: nebiusEdition ? 'Backup and restore' : 'Workspace portability' }).first().click();
	await page.getByRole('button', { name: 'Prepare export' }).click();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Download export' }).click();
	const download = await downloadPromise;
	const exportPath = await download.path();
	assert.ok(exportPath, 'export download has a readable temporary path');
	const exported = JSON.parse(await readFile(exportPath, 'utf8'));
	const newer = structuredClone(exported);
	newer.state.packs.push({ ...newer.state.packs[0], id: 'latest-backup-item', title: 'Latest backup item' });
	newer.state.manualOrder.push('latest-backup-item');
	const input = page.locator('input[type="file"]');
	const preview = page.locator('.challenge-import-preview');
	await page.evaluate(() => {
		const read = File.prototype.text;
		File.prototype.text = function () {
			if (this.name !== 'slow-backup.json') return read.call(this);
			return new Promise((resolve, reject) => {
				window.deferredBackupRead = { finish: async (fail) => {
					if (fail) reject(new Error('Earlier file read failed'));
					else resolve(await read.call(this));
				} };
			});
		};
	});
	async function startSlowRead() {
		await page.evaluate(() => { window.deferredBackupRead = null; });
		await input.setInputFiles({ name: 'slow-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
		await page.waitForFunction(() => Boolean(window.deferredBackupRead));
	}
	async function finishSlowRead(fail = false) {
		await page.evaluate(async (reject) => {
			await window.deferredBackupRead.finish(reject);
			await new Promise(requestAnimationFrame);
		}, fail);
	}
	for (const rejectEarlier of [false, true]) {
		await startSlowRead();
		await input.setInputFiles({ name: 'latest-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(newer)) });
		await page.waitForFunction(count => document.querySelector('.challenge-import-preview')?.textContent.includes(`${count} work items`), newer.state.packs.length);
		await finishSlowRead(rejectEarlier);
		assert.match(await preview.innerText(), new RegExp(`${newer.state.packs.length} work items`), 'An older read must not replace the latest file preview');
		assert.equal(await page.locator('.challenge-import-error').count(), 0, 'An older failure must not mark the latest file invalid');
		assert.equal(await input.evaluate(node => node.files[0].name), 'latest-backup.json');
	}
	await startSlowRead();
	await input.setInputFiles([]);
	await finishSlowRead();
	assert.equal(await preview.count(), 0, 'Clearing the file selection must invalidate a pending read');
	assert.equal(await page.getByRole('button', { name: 'Replace', exact: true }).count(), 0);
	await page.evaluate(() => {
		const key = 'projects-webmcp-challenge-state-v1';
		const current = JSON.parse(localStorage.getItem(key));
		current.state.manualOrder.reverse();
		current.revision = 'portability-order-before-replace';
		localStorage.setItem(key, JSON.stringify(current));
	});
	await page.reload({ waitUntil: 'networkidle' });
	await page.locator('summary, button').filter({ hasText: nebiusEdition ? 'Backup and restore' : 'Workspace portability' }).first().click();
	await page.locator('input[type="file"]').setInputFiles(exportPath);
	await page.getByText(/existing ID collisions/u).waitFor();
	assert.equal(await page.getByRole('button', { name: 'Confirm Replace' }).count(), 0, 'Replace is not confirmed before the user asks for it');
	await page.getByRole('button', { name: 'Replace' }).click();
	await page.getByRole('dialog', { name: 'Confirm workspace replacement' }).waitFor();
	assert.equal(await page.getByRole('dialog', { name: 'Confirm workspace replacement' }).getByRole('button', { name: 'Confirm Replace' }).count(), 1);
	await page.getByRole('dialog', { name: 'Confirm workspace replacement' }).getByRole('button', { name: 'Confirm Replace' }).click();
	await page.locator('.challenge-import-preview').waitFor({ state: 'detached' });
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('projects-webmcp-challenge-state-v1')).state);
	assert.deepEqual(saved.manualOrder, exported.state.manualOrder, 'Replace preserves the exported manual order');
	console.log(JSON.stringify({ edition: nebiusEdition ? 'nebius' : 'webmcp', export: true, collisionPreview: true, replaceConfirmation: true, manualOrderPreserved: true, latestFileWins: true, staleFileErrorIgnored: true, clearedSelectionStaysEmpty: true }));
} finally {
	await browser?.close();
	if (server.exitCode === null && server.signalCode === null) {
		const stopped = once(server, 'close');
		server.kill();
		await stopped;
	}
}
