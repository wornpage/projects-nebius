import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createProjectPlanState, assertProjectState, PROJECT_STATE_LIMITS } from '../svelte-frontend/src/lib/nebius-project-state.mjs';
import { authoredPreviewReference, materializeAuthoredChecker } from './fixtures/nebius-release-checker.mjs';

const lib = new URL('../svelte-frontend/src/lib/', import.meta.url);
const require = createRequire(new URL('../svelte-frontend/package.json', import.meta.url));
const ts = require('typescript');
const dependencies = Object.fromEntries(await Promise.all([
	'nebius-contract.mjs', 'nebius-execution-contract.mjs',
	'canonical-text.mjs', 'browser-state-envelope.mjs', 'workflow-rules.mjs',
	'pending-next-action.mjs', 'batch-actions.mjs', 'nebius-project-state.mjs', 'nebius-replan-state.mjs', 'nebius-replan-contract.mjs'
].map(async (name) => [name, await import(new URL(name, lib))])));
const createdAt = '2026-09-28T01:00:00.000Z';
const brief = 'Create a small plan\nKeep its dependencies.';
const makePlan = () => ({ title: 'Approval project', summary: 'Two tasks\nOne predecessor.', missingInformation: [], tasks: [
	{ id: 'research', title: 'Research', purpose: 'Collect\nthe facts.', nextStep: 'Read the brief', doneWhen: 'Facts\tare documented.', dependsOn: null },
	{ id: 'write', title: 'Write report', purpose: 'Summarize the facts', nextStep: 'Draft report', doneWhen: 'Report reviewed', dependsOn: 'research' }
] });
const seed = () => ({ packs: [{ id: 'sample', title: 'Sample task', status: 'active', next: 'Open', blocker: 'None', memory: ['Keep me'] }] });
const approve = (state = seed(), overrides = {}) => createProjectPlanState(state, { brief, plan: makePlan(), approvalId: 'approval-1', source: 'manual', createdAt, ...overrides });

function writable(value) {
	const subscribers = new Set();
	return { subscribe(fn) { subscribers.add(fn); fn(value); return () => subscribers.delete(fn); },
		set(next) { value = next; for (const fn of subscribers) fn(value); },
		update(fn) { this.set(fn(value)); } };
}
function get(store) { let value; store.subscribe((next) => { value = next; })(); return value; }

// Execute the actual TypeScript state owner with browser facilities replaced by
// deterministic storage and locks. No copied persistence/recovery implementation.
function browserClient(serialized = null, { failWrite = false, failSeed = false, runFetch, runStartFetch, nebiusEdition = false } = {}) {
	let saved = serialized;
	let writes = 0;
	let removes = 0;
	let runReads = 0;
	let runStarts = 0;
	let tail = Promise.resolve();
	let pauseNext = null;
	const context = vm.createContext({ structuredClone, crypto: webcrypto, Date, Error, TypeError, SyntaxError, console, __NEBIUS_EDITION__: nebiusEdition,
		AbortController, DOMException, Headers, TextDecoder, Uint8Array, setTimeout, clearTimeout,
		localStorage: { getItem() { return saved; }, setItem(key, value) { if (failWrite) throw new Error('Full'); saved = value; writes += 1; }, removeItem() { saved = null; removes += 1; } },
		navigator: { locks: { request(name, options, operation) {
			assert.equal(name, 'projects-webmcp-challenge-state-v1-write');
			assert.equal(options.mode, 'exclusive');
			const pause = pauseNext; pauseNext = null;
			const result = tail.then(async () => { if (pause) await pause; return operation(); });
			tail = result.catch(() => {});
			return result;
		} } },
		fetch: async (url, options) => {
			if (String(url).startsWith('/api/nebius/runs/')) {
				assert.equal(options.headers.get('X-Nebius-Run-Format'), 'run-diagnostics.v3');
				if (options.method === 'POST') {
					runStarts += 1;
					if (!runStartFetch) throw new Error('Unexpected run start');
					return runStartFetch(url, options);
				}
				runReads += 1;
				assert.equal(options.method, 'GET');
				if (!runFetch) throw new Error('Unexpected run read');
				return runFetch(url, options);
			}
			if (failSeed) throw new Error('Offline'); return { ok: true, json: async () => seed().packs };
		}
	});
	function compile(name, extras = {}) {
		const source = readFileSync(new URL(name, lib), 'utf8');
		const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
		const exports = {};
		const resolve = (id) => {
			if (id === '$app/environment') return { browser: true };
			if (id === 'svelte/store') return { writable, get };
			if (id in extras) return extras[id];
			const key = id.replace(/^\$lib\//u, '').replace(/^\.\//u, '');
			if (key in dependencies) return dependencies[key];
			throw new Error(`Unexpected dependency ${id}`);
		};
		new vm.Script(`(function(exports, require) { ${code}\n })`, { filename: name }).runInContext(context)(exports, resolve);
		return exports;
	}
	const workflow = compile('demo-workflow.ts');
	const execution = compile('nebius-execution-client.ts');
	const client = compile('demo-client.ts', { '$lib/demo-workflow': workflow, './nebius-execution-client': execution });
	return { client, get saved() { return saved; }, get writes() { return writes; }, get removes() { return removes; },
		get runReads() { return runReads; }, get runStarts() { return runStarts; }, execution,
		async resumeComponent(packId) {
			const source = readFileSync(new URL('../svelte-frontend/src/routes/next/NebiusTaskRun.svelte', import.meta.url), 'utf8');
			const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'));
			const parsed = ts.createSourceFile('NebiusTaskRun.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
			const declarations = ['requireRunSession', 'resumeSavedRequest'].map(name => {
				const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
				assert.ok(declaration, `Exercise the actual component ${name} function, not a copied implementation.`);
				return declaration;
			});
			const scheduled = [];
			const pack = get(client.demoState).packs.find(item => item.id === packId);
			Object.assign(context, { pack, reference: pack.executionRun, resumeDisabled: false, disposed: false,
				actionRevision: 0, requestBusy: false, requestLabel: '', error: '', notice: '',
				configSessionRequired: false, runSessionGates: {},
				startRun: execution.startRun, NebiusRunClientError: execution.NebiusRunClientError,
				clearUnsentExecutionRunReference: client.clearUnsentExecutionRunReference,
				applyRecord: (id, key, record) => client.saveExecutionRunRecord(packId, id, key, record),
				isCurrentRun: (capturedId, id, key) => {
					const current = get(client.demoState).packs.find(item => item.id === capturedId);
					return current?.id === packId && current.executionRun?.id === id && current.executionRun.key === key;
				},
				scheduleRefresh: (...args) => scheduled.push(args) });
			// Evaluate the actual derived session expressions against this context;
			// a constant false stub would hide a gate set by requireRunSession.
			for (const name of ['currentSessionKey', 'runSessionRequired', 'sessionRequired']) {
				const declaration = parsed.statements.filter(ts.isVariableStatement)
					.flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(parsed) === name);
				const initializer = declaration?.initializer;
				assert.ok(initializer && ts.isCallExpression(initializer)
					&& initializer.expression.getText(parsed) === '$derived' && initializer.arguments.length === 1,
				`Bind the actual ${name} derived expression.`);
				new vm.Script(`Object.defineProperty(globalThis, ${JSON.stringify(name)}, { configurable: true,
					get() { return ${initializer.arguments[0].getText(parsed)}; } });`,
					{ filename: `NebiusTaskRun.${name}.ts` }).runInContext(context);
			}
			const code = ts.transpileModule(declarations.map(node => node.getText(parsed)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
			await new vm.Script(`(async () => { ${code}\n await resumeSavedRequest(); })()`, { filename: 'NebiusTaskRun.resumeSavedRequest.ts' }).runInContext(context);
			return { scheduled, error: context.error, notice: context.notice, requestBusy: context.requestBusy,
				configSessionRequired: context.configSessionRequired, runSessionGates: { ...context.runSessionGates }, sessionRequired: context.sessionRequired };
		},
		pauseWrite(promise) { pauseNext = promise; }, overwrite(value) { saved = value; } };
}
const envelope = (state, revision = 'revision-1') => JSON.stringify({ schemaVersion: 1, revision, state });
const json = (value) => JSON.parse(JSON.stringify(value));

test('saving a ready run appends evidence and survives export and reload without completing the task', async () => {
	const reference = await authoredPreviewReference(await materializeAuthoredChecker());
	const pack = { id: reference.input.packId, ...reference.input.pack, status: reference.input.currentStatus,
		completionEvidence: 'An earlier observation.', executionRun: reference };
	const browser = browserClient(envelope({ packs: [pack] }));
	await browser.client.refreshDemoState();
	const saved = await browser.client.saveExecutionRunEvidence(pack.id, reference.id, reference.key);
	assert.ok(saved.completionEvidence.startsWith('An earlier observation.\nNebius browser tool run ' + reference.id));
	assert.equal(saved.status, 'active');
	assert.deepEqual(json(saved.executionRun), reference);
	const firstEvidence = saved.completionEvidence;
	await browser.client.saveExecutionRunEvidence(pack.id, reference.id, reference.key);
	assert.equal(get(browser.client.demoState).packs[0].completionEvidence, firstEvidence, 'Saving twice never duplicates the run reference.');
	const reloaded = browserClient(browser.client.exportWorkspaceState());
	await reloaded.client.refreshDemoState();
	assert.equal(get(reloaded.client.demoState).packs[0].completionEvidence, firstEvidence);
	assert.equal(get(reloaded.client.demoState).packs[0].status, 'active');
	assert.equal(browser.runStarts + browser.runReads + reloaded.runStarts + reloaded.runReads, 0);
});

test('run evidence capacity refusal preserves prior evidence and the ready reference', async () => {
	const reference = await authoredPreviewReference(await materializeAuthoredChecker());
	const pack = { id: reference.input.packId, ...reference.input.pack, status: reference.input.currentStatus,
		completionEvidence: 'x'.repeat(2000), executionRun: reference };
	const initial = envelope({ packs: [pack] });
	const browser = browserClient(initial);
	await browser.client.refreshDemoState();
	await assert.rejects(browser.client.saveExecutionRunEvidence(pack.id, reference.id, reference.key), /Completion evidence is full/u);
	assert.equal(browser.saved, initial);
	assert.equal(browser.writes, 0);
});

test('multiline completion evidence stays bounded and rejects unsafe control characters', async () => {
	const browser = browserClient(envelope(seed()));
	await browser.client.refreshDemoState();
	for (const evidence of ['x'.repeat(2001), 'line\u0000break', 'line\u001bbreak', 'line\u007fbreak', 'line\u0085break']) {
		const state = seed(); state.packs[0].completionEvidence = evidence;
		assert.throws(() => browser.client.previewWorkspaceImport(envelope(state)), /invalid completionEvidence/u);
	}
	assert.equal(browser.writes, 0);
});

test('approved tool input requirements survive consent, task saving, export and reload', async () => {
	const plan = makePlan();
	plan.tasks[0].executionInputs = [{ id: 'packet', format: 'json' }];
	const approved = approve(seed(), { plan });
	assert.deepEqual(approved.tasks[0].executionInputs, plan.tasks[0].executionInputs);
	assert.notEqual(approved.tasks[0].executionInputs, plan.tasks[0].executionInputs);
	const browser = browserClient(envelope(approved.state));
	await browser.client.refreshDemoState();
	let pack = get(browser.client.demoState).packs.find(item => item.id === 'approval-1:research');
	const input = browser.client.buildExecutionRunInput(pack, 'nvidia/synthetic-checker-fixture');
	assert.equal(input.version, 'browser-tool.v3');
	assert.equal(input.requiredOutputs, null);
	assert.deepEqual(json(input.requiredInputFormats), [{ id: 'packet', format: 'json' }]);
	const signature = browser.client.packPathSignature(pack);
	await browser.client.savePackPath(pack.id, { executionInputs: [{ id: 'notes', format: 'text' }] }, signature);
	pack = get(browser.client.demoState).packs.find(item => item.id === pack.id);
	assert.notEqual(browser.client.packPathSignature(pack), signature);
	assert.deepEqual(json(pack.executionInputs), [{ id: 'notes', format: 'text' }]);
	const reference = { id: '00000000-0000-4000-8000-000000000001', key: 'a'.repeat(64), input, record: null };
	assert.equal(browser.client.executionRunMatchesCurrentTask(pack, reference), false);
	const destination = browserClient();
	await destination.client.refreshDemoState();
	await destination.client.importWorkspaceState(browser.client.exportWorkspaceState(), 'replace');
	assert.deepEqual(json(get(destination.client.demoState).packs.find(item => item.id === pack.id).executionInputs), [{ id: 'notes', format: 'text' }]);
	const reloaded = browserClient(destination.saved);
	await reloaded.client.refreshDemoState();
	assert.deepEqual(json(get(reloaded.client.demoState).packs.find(item => item.id === pack.id).executionInputs), [{ id: 'notes', format: 'text' }]);
});

test('long completion criteria survive saving and reload without changing the old request', async () => {
	const browser = browserClient(envelope(approve().state), { nebiusEdition: true });
	await browser.client.refreshDemoState();
	let pack = get(browser.client.demoState).packs.find(item => item.id === 'approval-1:research');
	const oldInput = browser.client.buildExecutionRunInput(pack, 'nvidia/synthetic-checker-fixture');
	const reference = { id: '00000000-0000-4000-8000-000000000001', key: 'a'.repeat(64), input: oldInput, record: null };
	const criteria = `${'A'.repeat(1320)} done safely.`;
	assert.ok(criteria.length > 1000);
	await browser.client.savePackPath(pack.id, { doneWhen: criteria }, browser.client.packPathSignature(pack));
	pack = get(browser.client.demoState).packs.find(item => item.id === pack.id);
	assert.equal(pack.doneWhen, criteria);
	assert.equal(oldInput.pack.doneWhen, 'Facts\tare documented.');
	assert.equal(browser.client.executionRunMatchesCurrentTask(pack, reference), false);
	const reloaded = browserClient(browser.saved, { nebiusEdition: true });
	await reloaded.client.refreshDemoState();
	const reloadedPack = get(reloaded.client.demoState).packs.find(item => item.id === pack.id);
	assert.equal(reloadedPack.doneWhen, criteria);
	assert.equal(reloaded.client.buildExecutionRunInput(reloadedPack, 'nvidia/synthetic-checker-fixture').pack.doneWhen, criteria);
	const before = reloaded.saved;
	await assert.rejects(reloaded.client.savePackPath(pack.id, { doneWhen: 'x'.repeat(4001) }, reloaded.client.packPathSignature(reloadedPack)), /at most 4000/u);
	assert.equal(reloaded.saved, before);
	assert.throws(() => reloaded.client.previewWorkspaceImport(envelope({ packs: [{ id: 'bad', title: 'Bad', status: 'active', doneWhen: 'x'.repeat(4001) }] })), /invalid doneWhen/u);
});

test('input requirement changes are atomic, stale guarded and refused during a run', async () => {
	const browser = browserClient(envelope(approve().state));
	await browser.client.refreshDemoState();
	let pack = get(browser.client.demoState).packs[1];
	const originalSignature = browser.client.packPathSignature(pack);
	await browser.client.savePackPath(pack.id, { executionInputs: [] }, originalSignature);
	pack = get(browser.client.demoState).packs[1];
	assert.deepEqual(json(pack.executionInputs), []);
	await assert.rejects(browser.client.savePackPath(pack.id, { executionInputs: null }, originalSignature), /Saved work changed/u);
	const prior = browser.saved;
	await assert.rejects(browser.client.savePackPath(pack.id, { executionInputs: [{ id: '#selector', format: 'json' }] }, browser.client.packPathSignature(pack)));
	assert.equal(browser.saved, prior);
	const input = browser.client.buildExecutionRunInput(pack, 'nvidia/synthetic-checker-fixture');
	const reference = { id: '00000000-0000-4000-8000-000000000002', key: 'b'.repeat(64), input, record: null };
	await browser.client.reserveExecutionRunReference(pack.id, reference);
	pack = get(browser.client.demoState).packs[1];
	const reserved = browser.saved;
	await assert.rejects(browser.client.savePackPath(pack.id, { executionInputs: null }, browser.client.packPathSignature(pack)), /finish the current run/u);
	assert.equal(browser.saved, reserved);
});

test('specifying current inputs does not add inferred requirements to a legacy snapshot', async () => {
	const browser = browserClient(envelope(approve().state));
	await browser.client.refreshDemoState();
	const pack = get(browser.client.demoState).packs[1];
	const input = browser.client.buildExecutionRunInput(pack, 'nvidia/synthetic-checker-fixture');
	input.version = 'browser-tool.v1'; delete input.requiredInputFormats; delete input.requiredOutputs;
	const reference = { id: '00000000-0000-4000-8000-000000000003', key: 'c'.repeat(64), input, record: null };
	assert.equal(browser.client.executionRunMatchesCurrentTask(pack, reference), true);
	assert.equal(browser.client.executionRunMatchesCurrentTask({ ...pack, executionInputs: [{ id: 'packet', format: 'json' }] }, reference), false);
	assert.equal(Object.hasOwn(reference.input, 'requiredInputFormats'), false);
	await assert.rejects(browser.client.reserveExecutionRunReference(pack.id, reference), /current input requirements/u);
});

function savedReservation(number = 1, version = 'browser-tool.v1') {
	const state = approve().state;
	const pack = state.packs[1];
	const input = dependencies['nebius-execution-contract.mjs'].validateRunInput({
		version, ...(version !== 'browser-tool.v1' ? { requiredInputFormats: null } : {}),
		...(version === 'browser-tool.v3' ? { requiredOutputs: null } : {}),
		packId: pack.id, pack: dependencies['nebius-contract.mjs'].projectTask(pack),
		currentStatus: pack.status, context: [], requestedModel: 'nvidia/synthetic-checker-fixture', consent: true
	});
	const reference = { id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`, key: 'a'.repeat(64), input, record: null };
	pack.executionRun = structuredClone(reference);
	return { state, packId: pack.id, reference };
}
const notFoundResponse = () => Response.json({ code: 'not_found', error: 'The saved run was not found.' }, { status: 404 });
function queuedReceipt(reference) {
	const { consent, ...snapshot } = reference.input;
	return dependencies['nebius-execution-contract.mjs'].validateRunRecord({
		...snapshot, id: reference.id, status: 'queued', attempt: 0, createdAt, updatedAt: createdAt,
		events: [], files: [], checks: [], usage: { modelCalls: 0, inputTokens: null, outputTokens: null, totalsComplete: false }, error: null
	});
}

for (const [name, status, code] of [
	['format change', 409, 'run_format_changed'], ['invalid retry', 400, 'invalid_request'],
	['model change', 409, 'model_changed'], ['run conflict', 409, 'run_conflict'],
	['input change', 409, 'run_input_changed'], ['daily ceiling', 429, 'daily_limit'],
	['rate limit', 429, 'rate_limited'], ['execution disabled', 404, 'execution_disabled']
]) test(`a lost initial response survives the actual component's ${name} resume rejection`, async () => {
	let serverReceipt = null, reference;
	const browser = browserClient(envelope(approve().state), {
		runStartFetch: () => {
			if (!serverReceipt) {
				serverReceipt = queuedReceipt(reference);
				throw new Error('Authored fixture: POST admitted, response lost.');
			}
			return Response.json({ code, error: 'Authored retry rejection; the earlier start may exist.' }, { status });
		},
		runFetch: () => Response.json({ run: serverReceipt })
	});
	await browser.client.refreshDemoState();
	const pack = get(browser.client.demoState).packs[1];
	reference = { id: '00000000-0000-4000-8000-000000000041', key: 'd'.repeat(64),
		input: browser.client.buildExecutionRunInput(pack, 'nvidia/synthetic-checker-fixture'), record: null };
	await browser.client.reserveExecutionRunReference(pack.id, reference);
	await assert.rejects(browser.execution.startRun(reference.id, reference.key, reference.input), error => error.uncertain === true);
	const reservedBytes = browser.saved, serverBefore = json(serverReceipt);
	const resumed = await browser.resumeComponent(pack.id);
	assert.equal(browser.saved, reservedBytes, 'A refused retry cannot remove or rewrite the earlier reference.');
	assert.deepEqual(json(get(browser.client.demoState).packs[1].executionRun), json(reference));
	assert.deepEqual(json(serverReceipt), serverBefore);
	assert.equal(browser.runStarts, 2, 'Both POSTs are authored transport fixtures, not model or Sandbox calls.');
	assert.equal(browser.runReads, 0);
	assert.equal(resumed.requestBusy, false);
	assert.equal(resumed.configSessionRequired, false);
	assert.deepEqual(resumed.runSessionGates, {}, 'An ordinary retry rejection must not create a session gate.');
	assert.equal(resumed.sessionRequired, false);
	assert.match(resumed.notice, /saved request is preserved/u);
	assert.equal(resumed.scheduled.length, 1);
	assert.deepEqual(resumed.scheduled[0].slice(0,3), [pack.id, reference.id, reference.key]);
	const recovered = await browser.execution.readRun(reference.id, reference.key, pack.id);
	await browser.client.saveExecutionRunRecord(pack.id, reference.id, reference.key, recovered);
	assert.equal(browser.runReads, 1);
	assert.deepEqual(json(get(browser.client.demoState).packs[1].executionRun.record), serverBefore);
	assert.deepEqual(json(serverReceipt), serverBefore);
});

test('format change keeps the reload diagnostic and an uncertain current-client start', async () => {
	const browser = browserClient(envelope(approve().state), { runStartFetch: () => Response.json({
		code: 'run_format_changed', error: 'Task execution was updated. Reload this page.'
	}, { status: 409 }) });
	await browser.client.refreshDemoState();
	const pack = get(browser.client.demoState).packs[1];
	const input = browser.client.buildExecutionRunInput(pack, 'nvidia/synthetic-checker-fixture');
	await assert.rejects(browser.execution.startRun('00000000-0000-4000-8000-000000000042', 'e'.repeat(64), input), error => {
		assert.equal(error.code, 'run_format_changed');
		assert.equal(error.status, 409);
		assert.equal(error.uncertain, true);
		assert.equal(error.definitiveStartRejection, false);
		assert.match(error.message, /Reload/u);
		return true;
	});
});

test('an unresolved current request can be retired after task drift without starting replacement work', async () => {
	const { state, packId, reference } = savedReservation(41, 'browser-tool.v3');
	const browser = browserClient(envelope(state), { runFetch: notFoundResponse,
		runStartFetch: () => { throw new Error('Authored lost start response'); } });
	await browser.client.refreshDemoState();
	await assert.rejects(browser.execution.startRun(reference.id, reference.key, reference.input), error => error.uncertain === true);
	const pack = get(browser.client.demoState).packs[1];
	await browser.client.savePackPath(packId, { purpose: 'Revised task requirements.' }, browser.client.packPathSignature(pack));
	const changed = get(browser.client.demoState).packs[1];
	assert.equal(browser.client.executionRunMatchesCurrentTask(changed, reference), false);
	await assert.rejects(browser.client.reserveExecutionRunReference(packId, { ...reference,
		id: '00000000-0000-4000-8000-000000000042', input: browser.client.buildExecutionRunInput(changed, 'nvidia/new-model') }), /current task execution/u);
	const saved = await browser.client.retireUnavailableExecutionRun(packId, reference, true);
	assert.equal(saved.executionRun, undefined);
	assert.deepEqual(json(saved.retiredExecutionRuns[0].reference), reference);
	assert.equal(saved.purpose, changed.purpose);
	assert.equal(browser.runReads, 1);
	assert.equal(browser.runStarts, 1, 'Retirement never starts replacement work.');
	await browser.client.reserveExecutionRunReference(packId, { ...reference,
		id: '00000000-0000-4000-8000-000000000042', input: browser.client.buildExecutionRunInput(saved, 'nvidia/new-model') });
	assert.equal(browser.runStarts, 1);
});

for (const status of ['cancelled', 'uncertain']) test(`later ${status} evidence survives refresh without reopening the run`, async () => {
	const { state, packId, reference } = savedReservation(43, 'browser-tool.v2');
	const browser = browserClient(envelope(state)); await browser.client.refreshDemoState();
	const stopped = { ...queuedReceipt(reference), status, error: status === 'uncertain' ? 'Submission outcome unknown.' : null,
		updatedAt: '2026-09-28T01:00:01.000Z', usage: { modelCalls: 1, inputTokens: null, outputTokens: null, totalsComplete: false } };
	await browser.client.saveExecutionRunRecord(packId, reference.id, reference.key, stopped);
	const enriched = { ...stopped, updatedAt: '2026-09-28T01:00:02.000Z',
		usage: { modelCalls: 1, inputTokens: 42, outputTokens: 17, totalsComplete: true },
		events: [{ at: '2026-09-28T01:00:02.000Z', message: 'Recorded a late generation response; the stopped run remains terminal.' }],
		generationAttempts: [{ attempt: 1, outcome: 'accepted', responseText: 'Authored late response fixture.', retention: 'retained', diagnostic: null }] };
	const updated = await browser.client.saveExecutionRunRecord(packId, reference.id, reference.key, enriched);
	assert.equal(updated.executionRun.record.status, status);
	assert.deepEqual(json(updated.executionRun.record.usage), enriched.usage);
	assert.deepEqual(json(updated.executionRun.record.generationAttempts), enriched.generationAttempts);
	const latest = json(updated.executionRun.record);
	for (const stale of [stopped, { ...enriched, status: 'queued', error: null, updatedAt: '2026-09-28T01:00:03.000Z' },
		{ ...enriched, status: 'failed', error: 'Contradictory terminal status.', updatedAt: '2026-09-28T01:00:03.000Z' }]) {
		const saved = await browser.client.saveExecutionRunRecord(packId, reference.id, reference.key, stale);
		assert.deepEqual(json(saved.executionRun.record), latest);
	}
	await assert.rejects(browser.client.saveExecutionRunRecord(packId, reference.id, reference.key,
		{ ...enriched, usage: { ...enriched.usage, inputTokens: 43 } }), /same update time/u);
	const reloaded = browserClient(browser.client.exportWorkspaceState()); await reloaded.client.refreshDemoState();
	assert.deepEqual(json(get(reloaded.client.demoState).packs[1].executionRun.record), latest);
	assert.equal(browser.runStarts + browser.runReads, 0);
});

for (const version of ['browser-tool.v1', 'browser-tool.v2']) {
const reservation = number => savedReservation(number, version);
test(`confirmed ${version} retirement rereads the server, preserves unknown history and permits a new input review`, async () => {
	const { state, packId, reference } = reservation();
	const browser = browserClient(envelope(state), { runFetch: notFoundResponse });
	await browser.client.refreshDemoState();
	const before = browser.saved;
	await assert.rejects(browser.client.retireUnavailableExecutionRun(packId, reference, false), /confirm local retirement/u);
	assert.equal(browser.runReads, 0); assert.equal(browser.saved, before);
	await assert.rejects(browser.execution.readRun(reference.id, reference.key, packId), error => error.status === 404 && error.code === 'not_found');
	const saved = await browser.client.retireUnavailableExecutionRun(packId, reference, true);
	assert.equal(browser.runReads, 2, 'the owner must reread after the initial review observation');
	assert.equal(saved.executionRun, undefined);
	assert.equal(saved.status, state.packs[1].status);
	assert.equal(saved.completionEvidence, undefined);
	const retired = saved.retiredExecutionRuns[0];
	assert.deepEqual(json(retired.reference), reference);
	assert.equal(retired.reason, 'server_not_found');
	assert.equal(new Date(retired.retiredAt).toISOString(), retired.retiredAt);
	assert.equal(retired.reference.record, null);
	assert.equal(Object.hasOwn(retired.reference.input, 'requiredInputFormats'), version === 'browser-tool.v2');
	await browser.client.savePackPath(packId, { executionInputs: [{ id: 'packet', format: 'json' }] }, browser.client.packPathSignature(saved));
	const pack = get(browser.client.demoState).packs.find(item => item.id === packId);
	const input = browser.client.buildExecutionRunInput(pack, reference.input.requestedModel);
	assert.equal(input.version, 'browser-tool.v3');
	assert.deepEqual(json(input.requiredInputFormats), [{ id: 'packet', format: 'json' }]);
	assert.equal(pack.executionRun, undefined, 'retirement must not reserve or start a replacement');
	await assert.rejects(browser.client.reserveExecutionRunReference(packId, { ...reference, input }), /retired task execution id/u);
	const destination = browserClient(); await destination.client.refreshDemoState();
	await destination.client.importWorkspaceState(browser.client.exportWorkspaceState(), 'replace');
	const reloaded = browserClient(destination.saved); await reloaded.client.refreshDemoState();
	assert.deepEqual(json(get(reloaded.client.demoState).packs.find(item => item.id === packId).retiredExecutionRuns), json(pack.retiredExecutionRuns));
});

for (const [label, runFetch] of [
	['401 credentials', () => Response.json({ code: 'unauthorized', error: 'Wrong key.' }, { status: 401 })],
	['403 access', () => Response.json({ code: 'forbidden', error: 'Access refused.' }, { status: 403 })],
	['404 other cause', () => Response.json({ code: 'execution_disabled', error: 'Execution is disabled.' }, { status: 404 })],
	['503 unavailable', () => Response.json({ code: 'unavailable', error: 'Service unavailable.' }, { status: 503 })],
	['invalid JSON', () => new Response('{', { status: 404, headers: { 'Content-Type': 'application/json' } })],
	['wrong MIME', () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })],
	['transport failure', () => { throw new Error('Offline'); }]
]) test(`${version} retirement refuses ${label} without releasing the reservation`, async () => {
	const { state, packId, reference } = reservation();
	const browser = browserClient(envelope(state), { runFetch }); await browser.client.refreshDemoState();
	const before = browser.saved;
	await assert.rejects(browser.client.retireUnavailableExecutionRun(packId, reference, true));
	assert.equal(browser.saved, before); assert.equal(browser.writes, 0); assert.equal(browser.runReads, 1);
});

test(`${version} server receipt prevents local retirement and remains available for refresh`, async () => {
	const { state, packId, reference } = reservation();
	const browser = browserClient(envelope(state), { runFetch: () => Response.json({ run: queuedReceipt(reference) }) });
	await browser.client.refreshDemoState(); const before = browser.saved;
	await assert.rejects(browser.client.retireUnavailableExecutionRun(packId, reference, true), /server receipt is available/u);
	assert.equal(browser.saved, before);
});

test(`${version} retirement rejects changed references, received records and a full history atomically`, async () => {
	for (const change of ['key', 'input', 'record', 'full', 'another-tab']) {
		const { state, packId, reference } = reservation();
		let release;
		const response = new Promise(resolve => { release = resolve; });
		const browser = browserClient(envelope(state), { runFetch: () => response }); await browser.client.refreshDemoState();
		const pending = browser.client.retireUnavailableExecutionRun(packId, reference, true);
		const changed = structuredClone(state); const pack = changed.packs[1];
		if (change === 'key' || change === 'another-tab') pack.executionRun.key = 'b'.repeat(64);
		if (change === 'input') pack.executionRun.input.pack.purpose = 'Changed authorized purpose.';
		if (change === 'record') pack.executionRun.record = queuedReceipt(reference);
		if (change === 'full') pack.retiredExecutionRuns = Array.from({ length: 8 }, (_, index) => ({
			reference: reservation(index + 10).reference, retiredAt: createdAt, reason: 'server_not_found'
		}));
		const current = envelope(changed, `changed-${change}`); browser.overwrite(current);
		if (change !== 'another-tab') await browser.client.refreshDemoState();
		release(notFoundResponse());
		await assert.rejects(pending, change === 'full' ? /history is full/u : change === 'another-tab' ? /Workspace changed by another tab/u : /no longer current/u);
		assert.equal(browser.saved, current); assert.equal(browser.writes, 0);
	}
});

test(`${version} retirement cannot discard state on a storage failure or aborted owner action`, async () => {
	const { state, packId, reference } = reservation();
	const storageFailure = browserClient(envelope(state), { failWrite: true, runFetch: notFoundResponse });
	await storageFailure.client.refreshDemoState(); const before = storageFailure.saved;
	await assert.rejects(storageFailure.client.retireUnavailableExecutionRun(packId, reference, true));
	assert.equal(storageFailure.saved, before);
	const browser = browserClient(envelope(state), { runFetch: notFoundResponse }); await browser.client.refreshDemoState();
	const controller = new AbortController(); controller.abort();
	await assert.rejects(browser.client.retireUnavailableExecutionRun(packId, reference, true, controller.signal), error => error.name === 'AbortError');
	assert.equal(browser.runReads, 0);
	let release; const paused = new Promise(resolve => { release = resolve; }); browser.pauseWrite(paused);
	const duringWrite = new AbortController();
	const pending = browser.client.retireUnavailableExecutionRun(packId, reference, true, duringWrite.signal);
	await new Promise(resolve => setTimeout(resolve, 0)); duringWrite.abort(); release();
	await assert.rejects(pending, error => error.name === 'AbortError');
	assert.equal(browser.saved, envelope(state)); assert.equal(browser.writes, 0);
});

test(`${version} received records and malformed or contradictory retired history are refused`, async () => {
	const { state, packId, reference } = reservation();
	const browser = browserClient(envelope(state), { runFetch: notFoundResponse }); await browser.client.refreshDemoState();
	const newReference = { ...reference, record: queuedReceipt(reference) };
	await assert.rejects(browser.client.retireUnavailableExecutionRun(packId, newReference, true), /Only an unresolved/u);
	assert.equal(browser.runReads, 0);
	const entry = { reference: reservation(10).reference, retiredAt: createdAt, reason: 'server_not_found' };
	for (const mutate of [
		item => { item.reason = 'cancelled'; },
		item => { item.retiredAt = 'unknown'; },
		item => { item.reference.record = queuedReceipt(item.reference); },
		item => { item.reference.input.version = 'browser-tool.v3'; item.reference.input.requiredInputFormats = null; },
		item => { item.reference.id = reference.id; },
		item => { item.reference.input.packId = 'another-task'; },
		item => { item.reference.key = 'bad'; }
	]) {
		const invalid = structuredClone(state); const bad = structuredClone(entry); mutate(bad);
		invalid.packs[1].retiredExecutionRuns = [bad];
		assert.throws(() => browser.client.previewWorkspaceImport(envelope(invalid)), /Retired|retired|Saved task execution/u);
	}
	const duplicate = structuredClone(state); duplicate.packs[1].retiredExecutionRuns = [entry, structuredClone(entry)];
	assert.throws(() => browser.client.previewWorkspaceImport(envelope(duplicate)), /invalid .*reference/u);
});
}

test('approval clones the workspace and preserves truthful plan fields and scoped dependencies', () => {
	const prior = seed();
	const original = structuredClone(prior);
	const result = approve(prior);
	assert.deepEqual(prior, original);
	assert.notEqual(result.state, prior);
	assert.deepEqual(result.state.packs[0], original.packs[0]);
	assert.equal(result.project.id, 'approval-1');
	assert.equal(result.project.source, 'manual');
	assert.equal(result.project.brief, brief);
	assert.equal(result.tasks[0].status, 'active');
	assert.equal(result.tasks[1].status, 'blocked');
	assert.equal(result.tasks[1].blockedBy, 'approval-1:research');
	assert.equal(result.tasks[1].blocker, 'Waiting for Research');
	assert.equal(result.state.selectedProjectId, result.project.id);
	for (const task of result.tasks) for (const field of ['owner', 'due', 'completionEvidence', 'progress']) assert.equal(field in task, false);
	assertProjectState(result.state);
});

test('invalid or cyclic plans and missing provenance fail before mutation', () => {
	const prior = seed();
	const original = structuredClone(prior);
	const cyclic = makePlan(); cyclic.tasks[0].dependsOn = 'write';
	for (const overrides of [{ plan: cyclic }, { approvalId: '' }, { approvalId: 'bad:id' }, { createdAt: undefined }, { source: undefined }, { createdAt: '2026-02-30T01:00:00.000Z' }, { brief: '' }]) {
		assert.throws(() => approve(prior, overrides));
		assert.deepEqual(prior, original);
	}
});

test('duplicate approval ids and bounded capacity reject the entire insertion', () => {
	const prior = approve().state;
	assert.throws(() => approve(prior), /already been used/u);
	const full = { projects: [{ ...approve().project, id: 'capacity-project' }], packs: Array.from({ length: PROJECT_STATE_LIMITS.tasks - 1 }, (_, i) => ({ id: `task-${i}`, projectId: 'capacity-project' })) };
	const original = structuredClone(full);
	assert.throws(() => approve(full), /capacity/u);
	assert.deepEqual(full, original);
	const projectFull = { packs: [], projects: Array.from({ length: PROJECT_STATE_LIMITS.projects }, (_, i) => ({ ...approve().project, id: `project-${i}` })) };
	assert.throws(() => approve(projectFull), /capacity/u);
});

test('project task capacity counts membership only and permits exactly the project limit', () => {
	const state = { projects: [{ ...approve().project, id: 'capacity-project' }], packs: [
		...Array.from({ length: 1001 }, (_, i) => ({ id: `legacy-${i}`, title: `Legacy ${i}` })),
		...Array.from({ length: PROJECT_STATE_LIMITS.tasks - 2 }, (_, i) => ({ id: `member-${i}`, projectId: 'capacity-project' }))
	] };
	const approved = approve(state).state;
	assert.equal(approved.packs.filter((pack) => pack.projectId !== undefined).length, PROJECT_STATE_LIMITS.tasks);
	assert.equal(approved.packs.length, 1001 + PROJECT_STATE_LIMITS.tasks);
	assertProjectState(approved);
	assert.throws(() => approve(approved, { approvalId: 'over-capacity' }), /capacity/u);
	const excess = structuredClone(approved);
	excess.packs.push({ id: 'excess', projectId: 'capacity-project' });
	assert.throws(() => assertProjectState(excess), /capacity/u);
});

test('large ungrouped legacy workspace survives reload, save, approval and both import modes', async () => {
	const legacy = { packs: Array.from({ length: 1001 }, (_, i) => ({ id: `legacy-${i}`, title: `Legacy ${i}`, status: 'active', next: 'Open' })) };
	const original = structuredClone(legacy);
	assertProjectState(legacy);
	const pure = approve(legacy);
	assert.equal(pure.state.packs.length, 1003);
	assert.deepEqual(legacy, original);
	const browser = browserClient(JSON.stringify(legacy));
	const loaded = await browser.client.refreshDemoState();
	assert.equal(loaded.packs.length, 1001);
	assert.deepEqual(json(loaded.packs), legacy.packs);
	await browser.client.savePackBrowserFields('legacy-0', (pack) => { pack.memory = ['Saved legacy work']; });
	const single = makePlan(); single.tasks = [single.tasks[0]];
	const receipt = await browser.client.approveProjectPlan(brief, single, 'large-approval', 'manual');
	assert.equal(receipt.state.packs.length, 1002);
	assert.equal(receipt.state.status, 'Approved Approval project with 1 task.');
	assert.equal(receipt.tasks.length, 1);
	const fresh = browserClient(browser.saved);
	const reloaded = await fresh.client.refreshDemoState();
	assert.deepEqual(json(reloaded), json(receipt.state));
	assert.equal(fresh.writes, 0);
	const exported = browser.client.exportWorkspaceState();
	const destination = browserClient();
	await destination.client.refreshDemoState();
	assert.equal(destination.client.previewWorkspaceImport(exported).packs, 1002);
	await destination.client.importWorkspaceState(exported, 'replace');
	assert.equal(get(destination.client.demoState).packs.length, 1002);
	assert.equal(get(destination.client.demoState).projects.length, 1);
	assert.equal(get(destination.client.demoState).packs[0].memory[0], 'Saved legacy work');
	const merge = browserClient();
	await merge.client.refreshDemoState();
	await merge.client.importWorkspaceState(exported, 'merge');
	assert.equal(get(merge.client.demoState).packs.length, 1003);
	assert.equal(get(merge.client.demoState).projects.length, 1);
	assert.equal(get(merge.client.demoState).packs.filter((pack) => pack.projectId).length, 1);
});

test('manual and Nebius approvals use one serialized write; dependency graph survives a fresh reload', async () => {
	for (const source of ['manual', 'nebius']) {
		const browser = browserClient();
		await browser.client.refreshDemoState();
		assert.equal(browser.writes, 0, 'proposal and seed load have no save');
		const receipt = await browser.client.approveProjectPlan(brief, makePlan(), 'approval-1', source);
		assert.equal(browser.writes, 1);
		assert.equal(receipt.project.source, source);
		assert.equal(receipt.tasks.length, 2);
		const fresh = browserClient(browser.saved);
		const loaded = await fresh.client.refreshDemoState();
		assert.deepEqual(json(loaded), json(receipt.state));
		assert.equal(fresh.writes, 0, 'valid linked tasks do not trigger recovery writes');
		assert.equal(loaded.packs[2].blockedBy, 'approval-1:research');
		assert.equal(loaded.recoveryQuarantine, undefined);
		const saved = browser.saved;
		await assert.rejects(browser.client.approveProjectPlan(brief, makePlan(), 'approval-1', source), /already been used/u);
		assert.equal(browser.saved, saved);
		assert.equal(browser.writes, 1);
	}
});

test('storage failure leaves the store and persisted workspace untouched', async () => {
	const initial = envelope(seed());
	const browser = browserClient(initial, { failWrite: true });
	await browser.client.refreshDemoState();
	const before = json(get(browser.client.demoState));
	await assert.rejects(browser.client.approveProjectPlan(brief, makePlan(), 'approval-1', 'manual'), /not saved/u);
	assert.deepEqual(json(get(browser.client.demoState)), before);
	assert.equal(browser.saved, initial);
	assert.equal(browser.writes, 0);
});

test('stale or concurrent approvals cannot partially overwrite the winning workspace', async () => {
	const browser = browserClient(envelope(seed()));
	await browser.client.refreshDemoState();
	let release;
	browser.pauseWrite(new Promise((resolve) => { release = resolve; }));
	const first = browser.client.approveProjectPlan(brief, makePlan(), 'approval-first', 'manual');
	const second = browser.client.approveProjectPlan(brief, makePlan(), 'approval-second', 'manual');
	release();
	const results = await Promise.allSettled([first, second]);
	assert.equal(results[0].status, 'fulfilled');
	assert.equal(results[1].status, 'rejected');
	assert.match(results[1].reason.message, /another tab/u);
	const saved = JSON.parse(browser.saved).state;
	assert.equal(saved.projects.length, 1);
	assert.equal(saved.projects[0].id, 'approval-first');
	assert.equal(saved.packs.length, 3);
	assert.equal(browser.writes, 1);
	const stale = browserClient(envelope(seed()));
	await stale.client.refreshDemoState();
	stale.overwrite(browser.saved);
	await assert.rejects(stale.client.approveProjectPlan(brief, makePlan(), 'approval-stale', 'manual'), /another tab/u);
	assert.equal(stale.saved, browser.saved);
});

test('corrupt record quarantine retains valid linked tasks and repairs genuinely missing references', async () => {
	const state = approve().state;
	state.packs.push({ id: 'broken', title: 'Bad\u0000title' });
	state.packs.push({ id: 'orphan', title: 'Orphan', blockedBy: 'missing', status: 'blocked', blocker: 'Waiting' });
	state.packs.push({ ...state.packs[0] });
	state.packs.push({ id: 'bad-membership', title: 'Member', projectId: 'missing-project' });
	state.pendingNextActionDrafts = [null];
	const browser = browserClient(envelope(state));
	const recovered = await browser.client.refreshDemoState();
	assert.equal(recovered.packs.length, 4);
	assert.equal(recovered.packs.find((pack) => pack.id === 'approval-1:write').blockedBy, 'approval-1:research');
	assert.equal(recovered.packs.find((pack) => pack.id === 'orphan').blockedBy, '');
	assert.deepEqual(new Set(recovered.recoveryQuarantine.map((entry) => entry.id)), new Set(['broken', 'orphan', 'sample', 'bad-membership', 'pending-approval']));
	assert.equal(recovered.projects[0].id, 'approval-1');
	const fresh = browserClient(browser.saved);
	const again = await fresh.client.refreshDemoState();
	assert.deepEqual(json(again), json(recovered));
	assert.equal(fresh.writes, 0);
});

test('invalid project metadata and cycles retain explicit quarantine evidence', async () => {
	const state = approve().state;
	state.projects.push({ id: 'invalid', title: 'Missing metadata' });
	state.packs[1].blockedBy = state.packs[2].id;
	const browser = browserClient(envelope(state));
	const recovered = await browser.client.refreshDemoState();
	assert.ok(recovered.recoveryQuarantine.some((entry) => entry.id === 'invalid'));
	assert.ok(recovered.recoveryQuarantine.some((entry) => /cyclic/u.test(entry.reason)));
	assert.equal(recovered.projects.length, 1);
	assert.equal(recovered.packs.length, 3);
	assertProjectState(recovered);
});

test('export and replace retain project metadata and membership; legacy replace clears old projects', async () => {
	const source = browserClient(envelope(approve().state));
	await source.client.refreshDemoState();
	const exported = source.client.exportWorkspaceState();
	const destination = browserClient();
	await destination.client.refreshDemoState();
	assert.equal(destination.client.previewWorkspaceImport(exported).packs, 3);
	const receipt = await destination.client.importWorkspaceState(exported, 'replace');
	assert.equal(receipt.packs, 3);
	const state = get(destination.client.demoState);
	assert.deepEqual(json(state.projects), json(approve().state.projects));
	assert.equal(state.selectedProjectId, 'approval-1');
	assert.equal(state.packs[2].projectId, 'approval-1');
	assert.equal(state.packs[2].blockedBy, 'approval-1:research');
	await destination.client.importWorkspaceState(envelope(seed()), 'replace');
	assert.deepEqual(json(get(destination.client.demoState).projects), []);
	assert.equal(get(destination.client.demoState).selectedProjectId, null);
	assert.equal(get(destination.client.demoState).packs.length, 1);
});

test('merge retains both project graphs and refuses metadata or membership collisions atomically', async () => {
	const prior = approve().state;
	const imported = approve({ packs: [] }, { approvalId: 'approval-2', source: 'nebius' }).state;
	const browser = browserClient(envelope(prior));
	await browser.client.refreshDemoState();
	const receipt = await browser.client.importWorkspaceState(envelope(imported), 'merge');
	assert.equal(receipt.packs, 2);
	assert.equal(get(browser.client.demoState).projects.length, 2);
	assert.equal(get(browser.client.demoState).packs.length, 5);
	const saved = browser.saved;
	const conflicting = structuredClone(prior); conflicting.projects[0].title = 'Unrelated project';
	await assert.rejects(browser.client.importWorkspaceState(envelope(conflicting), 'merge'), /Conflicting metadata/u);
	assert.equal(browser.saved, saved);
	const membership = { packs: [{ id: 'sample', title: 'Other sample', projectId: 'approval-1' }], projects: prior.projects };
	await assert.rejects(browser.client.importWorkspaceState(envelope(membership), 'merge'), /Conflicting project membership/u);
	assert.equal(browser.saved, saved);
	const orphan = structuredClone(imported); orphan.packs[0].projectId = 'missing';
	assert.throws(() => browser.client.previewWorkspaceImport(envelope(orphan)), /missing project/u);
	assert.equal(browser.saved, saved);
});

test('selection validates explicit project ids; full reset clears projects and their task refs', async () => {
	const browser = browserClient(envelope(approve().state));
	await browser.client.refreshDemoState();
	await browser.client.selectProject(null);
	assert.equal(get(browser.client.demoState).selectedProjectId, null);
	await browser.client.selectProject('approval-1');
	const saved = browser.saved;
	await assert.rejects(browser.client.selectProject('missing'), /not found/u);
	assert.equal(browser.saved, saved);
	const reset = await browser.client.resetDemoSampleState();
	assert.equal(reset.projects, undefined);
	assert.equal(reset.selectedProjectId, undefined);
	assert.equal(reset.packs.length, 1);
	assert.equal(reset.packs[0].projectId, undefined);
	assert.equal(browser.saved, null);
	assert.equal(browser.removes, 1);
});

test('authored outputs survive project creation, v3 consent, export/import and reload', async () => {
  const plan = makePlan();
  plan.tasks[0].executionInputs = [{ id: 'plan', format: 'json' }];
  plan.tasks[0].executionOutputs = [{ id: 'schedule', format: 'timeline' }];
  const approved = approve(seed(), { plan });
  assert.deepEqual(approved.tasks[0].executionOutputs, plan.tasks[0].executionOutputs);
  assert.notEqual(approved.tasks[0].executionOutputs, plan.tasks[0].executionOutputs);
  assert.throws(() => approve(seed(), { plan, source: 'nebius' }));
  const browser = browserClient(envelope(approved.state));
  await browser.client.refreshDemoState();
  const pack = get(browser.client.demoState).packs[1];
  const input = browser.client.buildExecutionRunInput(pack, 'nvidia/synthetic-checker-fixture');
  assert.equal(input.version, 'browser-tool.v3');
  assert.deepEqual(json(input.requiredOutputs), plan.tasks[0].executionOutputs);
  const destination = browserClient();
  await destination.client.refreshDemoState();
  await destination.client.importWorkspaceState(browser.client.exportWorkspaceState(), 'replace');
  const reloaded = browserClient(destination.saved);
  await reloaded.client.refreshDemoState();
  assert.deepEqual(json(get(reloaded.client.demoState).packs.find(item => item.id === pack.id).executionOutputs), plan.tasks[0].executionOutputs);
});

test('output transactions reject collisions, stale edits and in-flight changes atomically', async () => {
  const browser = browserClient(envelope(approve().state));
  await browser.client.refreshDemoState();
  let pack = get(browser.client.demoState).packs[1];
  const original = browser.client.packPathSignature(pack);
  await browser.client.savePackPath(pack.id, { executionOutputs: [{ id: 'summary', format: 'text' }] }, original);
  pack = get(browser.client.demoState).packs[1];
  assert.notEqual(browser.client.packPathSignature(pack), original);
  const saved = browser.saved;
  await assert.rejects(browser.client.savePackPath(pack.id, { executionOutputs: [] }, original), /Saved work changed/);
  await assert.rejects(browser.client.savePackPath(pack.id, { executionInputs: [{ id: 'summary', format: 'text' }] }));
  await assert.rejects(browser.client.savePackPath(pack.id, { executionInputs: [{ id: 'data', format: 'json' }], executionOutputs: [{ id: 'data', format: 'text' }] }));
  assert.equal(browser.saved, saved);
  const input = browser.client.buildExecutionRunInput(pack, 'nvidia/synthetic-checker-fixture');
  await browser.client.reserveExecutionRunReference(pack.id, { id: '00000000-0000-4000-8000-000000000099', key: 'a'.repeat(64), input, record: null });
  const reserved = browser.saved;
  await assert.rejects(browser.client.savePackPath(pack.id, { executionOutputs: null }), /finish the current run/);
  assert.equal(browser.saved, reserved);
});

test('v2 matching retains input semantics and never gains a v3 output declaration', async () => {
  const browser = browserClient(envelope(approve().state));
  await browser.client.refreshDemoState();
  const pack = { ...get(browser.client.demoState).packs[1], executionInputs: [{ id: 'data', format: 'json' }] };
  const input = browser.client.buildExecutionRunInput(pack, 'nvidia/synthetic-checker-fixture');
  input.version = 'browser-tool.v2'; delete input.requiredOutputs;
  const reference = { id: '00000000-0000-4000-8000-000000000098', key: 'b'.repeat(64), input, record: null };
  const original = JSON.stringify(reference);
  assert.equal(browser.client.executionRunMatchesCurrentTask(pack, reference), true);
  assert.equal(browser.client.executionRunMatchesCurrentTask({ ...pack, executionOutputs: [] }, reference), false);
  assert.equal(browser.client.executionRunMatchesCurrentTask({ ...pack, executionInputs: [] }, reference), false);
  assert.equal(JSON.stringify(reference), original);
});
