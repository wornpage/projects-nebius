import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	getWebMcpCatalogSnapshot,
	registerPageTools,
	webMcpCatalog
} from '../svelte-frontend/src/lib/webmcp.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function descriptor(name) {
	return {
		name,
		description: `Test ${name}`,
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		execute: async () => ({ name })
	};
}

test('unsupported browsers retain the ordinary page and publish the passed page catalog without registering', () => {
	const tool = {
		...descriptor('read-current-view'),
		description: 'Exact unsupported-browser descriptor.',
		annotations: { readOnlyHint: true }
	};
	const cleanup = registerPageTools({ modelContext: { registerTool: undefined } }, [tool]);
	assert.deepEqual(getWebMcpCatalogSnapshot(), {
		status: 'unavailable',
		tools: [{
			name: tool.name,
			description: tool.description,
			authority: 'read-only'
		}]
	});
	cleanup();
	assert.deepEqual(getWebMcpCatalogSnapshot(), { status: 'connecting', tools: [] });
});

test('one page lifecycle signal owns every route tool registration', async () => {
	const registrations = [];
	const documentRef = {
		modelContext: {
			registerTool(tool, options) {
				registrations.push({ tool, options });
				return Promise.resolve();
			}
		}
	};
	const errors = [];
	const cleanup = registerPageTools(
		documentRef,
		[descriptor('read-current-view'), descriptor('change-current-view')],
		{ onError: (error, tool) => errors.push({ error, tool }) }
	);

	assert.deepEqual(registrations.map(({ tool }) => tool.name), ['read-current-view', 'change-current-view']);
	assert.ok(registrations.every(({ options }) => options.signal instanceof AbortSignal));
	assert.equal(registrations[0].options.signal, registrations[1].options.signal);
	assert.equal(registrations[0].options.signal.aborted, false);
	cleanup();
	cleanup();
	assert.equal(registrations[0].options.signal.aborted, true);
	await Promise.resolve();
	assert.deepEqual(errors, []);
});

test('successful executions retain their narrow descriptor and leave one route-owned result receipt', async () => {
	let registered;
	const results = [];
	const tool = {
		...descriptor('read-current-view'),
		title: 'Read current view',
		annotations: { readOnlyHint: true }
	};
	const cleanup = registerPageTools({
		modelContext: {
			registerTool(candidate) {
				registered = candidate;
			}
		}
	}, [tool], {
		onResult: async (receipt) => {
			await Promise.resolve();
			results.push(receipt);
		}
	});

	assert.equal(registered.name, tool.name);
	assert.equal(registered.title, tool.title);
	assert.equal(registered.inputSchema, tool.inputSchema);
	assert.equal(registered.annotations, tool.annotations);
	assert.deepEqual(await registered.execute({}), { name: tool.name });
	assert.deepEqual(results, [{
		toolName: tool.name,
		toolTitle: tool.title,
		result: { name: tool.name }
	}]);

	cleanup();
	assert.deepEqual(await registered.execute({}), { name: tool.name });
	assert.equal(results.length, 1, 'teardown suppresses late route receipt updates');
});

test('a thrown invocation clears any provisional route receipt and never claims success', async () => {
	const failure = new Error('tool failed before it had a result');
	let registered;
	let visibleReceipt = { summary: 'Provisional success' };
	const results = [];
	const failures = [];
	registerPageTools({
		modelContext: { registerTool(candidate) { registered = candidate; } }
	}, [{
		...descriptor('failing-tool'),
		title: 'Fail after presenting',
		execute: async () => {
			visibleReceipt = { summary: 'Presented before final validation' };
			throw failure;
		}
	}], {
		onInvocationError: async (invocation) => {
			await Promise.resolve();
			visibleReceipt = null;
			failures.push(invocation);
		},
		onResult: (receipt) => results.push(receipt)
	});

	await assert.rejects(() => registered.execute({}), failure);
	assert.equal(visibleReceipt, null);
	assert.deepEqual(results, []);
	assert.deepEqual(failures, [{
		toolName: 'failing-tool',
		toolTitle: 'Fail after presenting',
		error: failure
	}]);
});

test('teardown suppresses pending registration failures while live failures retain tool identity', async () => {
	let rejectPending;
	const pendingErrors = [];
	const cleanup = registerPageTools({
		modelContext: {
			registerTool() {
				return new Promise((_resolve, reject) => { rejectPending = reject; });
			}
		}
	}, [descriptor('pending-tool')], {
		onError: (error, tool) => pendingErrors.push({ error, tool })
	});
	cleanup();
	rejectPending(new Error('registration ended during teardown'));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(pendingErrors, []);

	const liveFailure = new Error('live registration failure');
	const liveErrors = [];
	registerPageTools({
		modelContext: { registerTool: () => Promise.reject(liveFailure) }
	}, [descriptor('live-tool')], {
		onError: (error, tool) => liveErrors.push({ error, tool })
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(liveErrors, [{ error: liveFailure, tool: 'live-tool' }]);

	const syncFailure = new Error('synchronous registration failure');
	const syncErrors = [];
	registerPageTools({
		modelContext: { registerTool: () => { throw syncFailure; } }
	}, [descriptor('sync-tool')], {
		onError: (error, tool) => syncErrors.push({ error, tool })
	});
	assert.deepEqual(syncErrors, [{ error: syncFailure, tool: 'sync-tool' }]);
});

test('a synchronous mixed-registration failure aborts the whole page catalog and stops later registrations', () => {
	const active = new Set();
	const attempted = [];
	const errors = [];
	const failure = new Error('second registration failed');
	const cleanup = registerPageTools({
		modelContext: {
			registerTool(tool, { signal }) {
				attempted.push(tool.name);
				if (tool.name === 'second-tool') throw failure;
				active.add(tool.name);
				signal.addEventListener('abort', () => active.delete(tool.name), { once: true });
				return Promise.resolve();
			}
		}
	}, [descriptor('first-tool'), descriptor('second-tool'), descriptor('third-tool')], {
		onError: (error, tool) => errors.push({ error, tool })
	});

	assert.deepEqual(attempted, ['first-tool', 'second-tool']);
	assert.deepEqual([...active], []);
	assert.deepEqual(errors, [{ error: failure, tool: 'second-tool' }]);
	cleanup();
});

test('an asynchronous mixed-registration failure aborts the whole page catalog and reports only its first live failure', async () => {
	const active = new Set();
	const registrations = [];
	const errors = [];
	const secondFailure = new Error('second registration rejected');
	const thirdFailure = new Error('third registration rejected after the catalog failed');
	const cleanup = registerPageTools({
		modelContext: {
			registerTool(tool, { signal }) {
				registrations.push({ tool: tool.name, signal });
				active.add(tool.name);
				signal.addEventListener('abort', () => active.delete(tool.name), { once: true });
				if (tool.name === 'second-tool') return Promise.reject(secondFailure);
				if (tool.name === 'third-tool') return Promise.reject(thirdFailure);
				return Promise.resolve();
			}
		}
	}, [descriptor('first-tool'), descriptor('second-tool'), descriptor('third-tool')], {
		onError: (error, tool) => errors.push({ error, tool })
	});

	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(registrations.length, 3);
	assert.equal(new Set(registrations.map(({ signal }) => signal)).size, 1);
	assert.equal(registrations[0].signal.aborted, true);
	assert.deepEqual([...active], []);
	assert.deepEqual(errors, [{ error: secondFailure, tool: 'second-tool' }]);
	cleanup();
});

test('invalid descriptor collections fail loudly instead of registering a partial catalog', () => {
	const documentRef = { modelContext: { registerTool() { throw new Error('must not register'); } } };
	assert.throws(() => registerPageTools(documentRef, null), /array of tool descriptors/u);
	assert.throws(() => registerPageTools(documentRef, []), /at least one tool descriptor/u);
	assert.throws(() => registerPageTools(documentRef, [descriptor('duplicate'), descriptor('duplicate')]), /unique tool names/u);
	assert.throws(() => registerPageTools(documentRef, [{ name: 'missing-execute' }]), /executable tool descriptor/u);
	assert.throws(() => registerPageTools(documentRef, [{ ...descriptor('missing-description'), description: '' }]), /require descriptions/u);
	assert.throws(() => registerPageTools(documentRef, [descriptor('valid')], { onInvocationError: true }), /invocation error handling requires a function/u);
	assert.throws(() => registerPageTools(documentRef, [descriptor('valid')], { onResult: true }), /result handling requires a function/u);
});

test('catalog remains connecting until every registration promise resolves', async () => {
	const resolvers = new Map();
	const states = [];
	const unsubscribe = webMcpCatalog.subscribe((state) => states.push(state));
	const tools = [
		{ ...descriptor('first-reader'), description: 'Read first.', annotations: { readOnlyHint: true } },
		{ ...descriptor('second-presenter'), description: 'Present second.', annotations: { readOnlyHint: false } }
	];
	const cleanup = registerPageTools({
		modelContext: {
			registerTool(tool) {
				return new Promise((resolve) => resolvers.set(tool.name, resolve));
			}
		}
	}, tools);

	assert.deepEqual(getWebMcpCatalogSnapshot(), {
		status: 'connecting',
		tools: [
			{ name: 'first-reader', description: 'Read first.', authority: 'read-only' },
			{ name: 'second-presenter', description: 'Present second.', authority: 'page-changing-or-draft' }
		]
	});
	resolvers.get('first-reader')();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(getWebMcpCatalogSnapshot().status, 'connecting');
	resolvers.get('second-presenter')();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(getWebMcpCatalogSnapshot().status, 'ready');
	assert.ok(states.some(({ status }) => status === 'connecting'));
	assert.ok(states.some(({ status }) => status === 'ready'));

	unsubscribe();
	cleanup();
});

test('any registration rejection publishes error, aborts the catalog, and cannot settle ready later', async () => {
	let resolveFirst;
	let rejectSecond;
	const signals = [];
	const cleanup = registerPageTools({
		modelContext: {
			registerTool(tool, { signal }) {
				signals.push(signal);
				return new Promise((resolve, reject) => {
					if (tool.name === 'first-tool') resolveFirst = resolve;
					else rejectSecond = reject;
				});
			}
		}
	}, [descriptor('first-tool'), descriptor('second-tool')], { onError: () => {} });

	rejectSecond(new Error('registration failed'));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(getWebMcpCatalogSnapshot().status, 'error');
	assert.ok(signals.every(({ aborted }) => aborted));
	resolveFirst();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(getWebMcpCatalogSnapshot().status, 'error');
	cleanup();
});

test('teardown prevents stale catalog settlement and cannot clear the next SPA page catalog', async () => {
	let resolveOld;
	const cleanupOld = registerPageTools({
		modelContext: {
			registerTool() {
				return new Promise((resolve) => { resolveOld = resolve; });
			}
		}
	}, [{ ...descriptor('old-page-tool'), description: 'Old page.' }]);
	cleanupOld();

	const cleanupCurrent = registerPageTools({
		modelContext: { registerTool: () => Promise.resolve() }
	}, [{ ...descriptor('current-page-tool'), description: 'Current page.' }]);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(getWebMcpCatalogSnapshot(), {
		status: 'ready',
		tools: [{ name: 'current-page-tool', description: 'Current page.', authority: 'page-changing-or-draft' }]
	});

	resolveOld();
	await new Promise((resolve) => setImmediate(resolve));
	cleanupOld();
	assert.deepEqual(getWebMcpCatalogSnapshot(), {
		status: 'ready',
		tools: [{ name: 'current-page-tool', description: 'Current page.', authority: 'page-changing-or-draft' }]
	});
	cleanupCurrent();
});
