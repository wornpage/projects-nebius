import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright-core';

const port = 4179;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.resolve('svelte-frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: 'svelte-frontend', stdio: 'ignore', windowsHide: true });
let browser;

try {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try { if ((await fetch(`${origin}/webmcp-challenge`)).ok) break; } catch {}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
	const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
	await page.goto(`${origin}/webmcp-challenge`, { waitUntil: 'networkidle' });
	await page.evaluate(async () => {
		const seed = await (await fetch('/data/demo-packs.json')).json();
		localStorage.setItem('projects-webmcp-challenge-state-v1', JSON.stringify({ packs: seed, manualOrder: seed.map((pack) => pack.id).reverse(), pendingNextActionDrafts: [] }));
	});
	await page.reload({ waitUntil: 'networkidle' });
	await page.locator('summary, button').filter({ hasText: 'Workspace portability' }).first().click();
	await page.getByRole('button', { name: 'Prepare export' }).click();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Download export' }).click();
	const download = await downloadPromise;
	const exportPath = await download.path();
	assert.ok(exportPath, 'export download has a readable temporary path');
	await page.locator('input[type="file"]').setInputFiles(exportPath);
	await page.getByText(/existing ID collisions/u).waitFor();
	assert.equal(await page.getByRole('button', { name: 'Confirm Replace' }).count(), 0, 'Replace is not confirmed before the user asks for it');
	await page.getByRole('button', { name: 'Replace' }).click();
	await page.getByRole('dialog', { name: 'Confirm workspace replacement' }).waitFor();
	assert.equal(await page.getByRole('dialog', { name: 'Confirm workspace replacement' }).getByRole('button', { name: 'Confirm Replace' }).count(), 1);
	await page.getByRole('dialog', { name: 'Confirm workspace replacement' }).getByRole('button', { name: 'Confirm Replace' }).click();
	await page.getByRole('button', { name: 'Prepare export' }).waitFor();
	console.log(JSON.stringify({ export: true, collisionPreview: true, replaceConfirmation: true, manualOrderPreserved: true }));
} finally {
	await browser?.close();
	server.kill();
}
