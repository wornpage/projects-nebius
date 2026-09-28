import {
	isRunConfig,
	validRunId,
	validRunKey,
	validateRunInput,
	validateRunIntegrity,
	type RunConfig,
	type RunInput,
	type RunRecord
} from './nebius-execution-contract.mjs';

const JSON_RESPONSE_LIMIT_BYTES = 512 * 1024;
const HTML_RESPONSE_LIMIT_BYTES = 256 * 1024;
const REQUEST_DEADLINE_MS = 15_000;
const DEFINITIVE_START_REJECTIONS = new Set([
	'400:invalid_request',
	'404:execution_disabled',
	'409:model_changed',
	'409:run_conflict',
	'429:rate_limited',
	'429:daily_limit'
]);

type RunResponse = { run: RunRecord };
type ApiErrorBody = { code: string; error: string };
type DisabledConfigBody = ApiErrorBody & { available: false };

export type RunConfigState =
	| { available: true; config: RunConfig }
	| { available: false; message: string };

export class NebiusRunClientError extends Error {
	readonly code: string;
	readonly status: number;
	readonly uncertain: boolean;
	readonly definitiveStartRejection: boolean;

	constructor(message: string, options: { code?: string; status?: number; uncertain?: boolean; definitiveStartRejection?: boolean } = {}) {
		super(message);
		this.name = 'NebiusRunClientError';
		this.code = options.code || 'run_request_failed';
		this.status = options.status || 0;
		this.uncertain = options.uncertain === true;
		this.definitiveStartRejection = options.definitiveStartRejection === true;
	}
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)) &&
		Object.keys(value as Record<string, unknown>).sort().join(',') === [...keys].sort().join(',');
}

function boundedErrorText(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value);
}

function parseApiError(value: unknown): ApiErrorBody | DisabledConfigBody | null {
	if (exactRecord(value, ['code', 'error']) && boundedErrorText(value.code, 80) && boundedErrorText(value.error, 500)) {
		return { code: value.code, error: value.error };
	}
	if (exactRecord(value, ['available', 'code', 'error']) && value.available === false && boundedErrorText(value.code, 80) && boundedErrorText(value.error, 500)) {
		return { available: false, code: value.code, error: value.error };
	}
	return null;
}

async function boundedText(response: Response, maximumBytes: number, expectedMime: 'application/json' | 'text/html'): Promise<string> {
	const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
	if (mime !== expectedMime) {
		throw new NebiusRunClientError(`The task execution service returned an unexpected ${mime || 'missing'} content type.`, { status: response.status });
	}
	const declared = response.headers.get('content-length');
	if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > maximumBytes) {
		throw new NebiusRunClientError('The task execution response exceeded its size limit.', { status: response.status });
	}
	if (!response.body) throw new NebiusRunClientError('The task execution response body is unavailable.', { status: response.status });
	const reader = response.body.getReader();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let total = 0;
	let body = '';
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maximumBytes) {
				await reader.cancel();
				throw new NebiusRunClientError('The task execution response exceeded its size limit.', { status: response.status });
			}
			body += decoder.decode(value, { stream: true });
		}
		body += decoder.decode();
		return body;
	} catch (error) {
		if (error instanceof NebiusRunClientError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
		throw new NebiusRunClientError('The task execution response was not valid UTF-8.', { status: response.status });
	} finally {
		reader.releaseLock();
	}
}

async function boundedJson(response: Response): Promise<unknown> {
	const body = await boundedText(response, JSON_RESPONSE_LIMIT_BYTES, 'application/json');
	try {
		return JSON.parse(body) as unknown;
	} catch {
		throw new NebiusRunClientError('The task execution service returned invalid JSON.', { status: response.status });
	}
}

function checkedResponse(response: Response, value: unknown): unknown {
	if (!response.ok) {
		const error = parseApiError(value);
		throw new NebiusRunClientError(error?.error || `Task execution request failed (${response.status}).`, {
			code: error?.code,
			status: response.status
		});
	}
	return value;
}

async function withRequestDeadline<T>(signal: AbortSignal | undefined, action: (requestSignal: AbortSignal) => Promise<T>): Promise<T> {
	const controller = new AbortController();
	const abort = () => controller.abort(signal?.reason);
	if (signal?.aborted) abort();
	else signal?.addEventListener('abort', abort, { once: true });
	const timer = setTimeout(() => controller.abort('deadline'), REQUEST_DEADLINE_MS);
	try {
		return await action(controller.signal);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', abort);
	}
}

async function fetchJson(input: RequestInfo | URL, init: RequestInit, signal?: AbortSignal): Promise<{ response: Response; value: unknown }> {
	return withRequestDeadline(signal, async (requestSignal) => {
		const response = await fetch(input, { ...init, signal: requestSignal });
		return { response, value: await boundedJson(response) };
	});
}

function endpoint(runId: string): string {
	if (!validRunId(runId)) throw new NebiusRunClientError('The saved task execution id is invalid.');
	return `/api/nebius/runs/${runId}`;
}

function authorization(runKey: string): string {
	if (!validRunKey(runKey)) throw new NebiusRunClientError('The saved task execution access key is invalid.');
	return `Bearer ${runKey}`;
}

async function parseRunResponse(value: unknown, expectedId: string, expectedPackId: string): Promise<RunResponse> {
	if (!exactRecord(value, ['run'])) throw new NebiusRunClientError('The task execution response has an unexpected shape.');
	let run: RunRecord;
	try {
		run = await validateRunIntegrity(value.run);
	} catch (error) {
		throw new NebiusRunClientError(error instanceof Error ? error.message : 'The task execution response is invalid.');
	}
	if (run.id !== expectedId || run.packId !== expectedPackId) {
		throw new NebiusRunClientError('The task execution response does not match the requested task.');
	}
	return { run };
}

export function createRunCredentials(): { id: string; key: string } {
	if (!globalThis.crypto?.randomUUID || !globalThis.crypto?.getRandomValues) {
		throw new NebiusRunClientError('This browser cannot create secure task execution credentials.');
	}
	const id = globalThis.crypto.randomUUID();
	const keyBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
	const key = Array.from(keyBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	if (!validRunId(id) || !validRunKey(key)) throw new NebiusRunClientError('This browser could not create valid task execution credentials.');
	return { id, key };
}

export async function getRunConfig(signal?: AbortSignal): Promise<RunConfigState> {
	try {
		const { response, value } = await fetchJson('/api/nebius/runs/config', {
			cache: 'no-store',
			credentials: 'same-origin',
			headers: { Accept: 'application/json' }
		}, signal);
		if (!response.ok) {
			const error = parseApiError(value);
			if (response.status === 404 && error?.code === 'execution_disabled') {
				return { available: false, message: error.error };
			}
			throw new NebiusRunClientError(error?.error || `Task execution availability check failed (${response.status}).`, {
				code: error?.code,
				status: response.status
			});
		}
		if (!exactRecord(value, ['available', 'version', 'requestedModel', 'limits']) || !isRunConfig(value)) {
			throw new NebiusRunClientError('Task execution settings are invalid.');
		}
		return { available: true, config: value };
	} catch (error) {
		if (signal?.aborted) throw error;
		if (error instanceof NebiusRunClientError) throw error;
		throw new NebiusRunClientError('Task execution availability could not be checked.');
	}
}

export async function startRun(runId: string, runKey: string, input: RunInput, signal?: AbortSignal): Promise<RunRecord> {
	const validated = validateRunInput(input);
	try {
		const { response, value } = await fetchJson(endpoint(runId), {
			method: 'POST',
			cache: 'no-store',
			credentials: 'same-origin',
			headers: {
				Accept: 'application/json',
				Authorization: authorization(runKey),
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(validated)
		}, signal);
		return (await parseRunResponse(checkedResponse(response, value), runId, validated.packId)).run;
	} catch (error) {
		if (error instanceof NebiusRunClientError && DEFINITIVE_START_REJECTIONS.has(`${error.status}:${error.code}`)) {
			throw new NebiusRunClientError(error.message, { code: error.code, status: error.status, definitiveStartRejection: true });
		}
		throw new NebiusRunClientError('The start response could not be verified. The run may exist; refresh this saved run before taking another action.', { uncertain: true });
	}
}

async function requestKnownRun(method: 'GET' | 'DELETE', runId: string, runKey: string, packId: string, signal?: AbortSignal): Promise<RunRecord> {
	try {
		const { response, value } = await fetchJson(endpoint(runId), {
			method,
			cache: 'no-store',
			credentials: 'same-origin',
			headers: { Accept: 'application/json', Authorization: authorization(runKey) }
		}, signal);
		return (await parseRunResponse(checkedResponse(response, value), runId, packId)).run;
	} catch (error) {
		if (method === 'DELETE' && !(error instanceof NebiusRunClientError && error.status >= 400 && error.status < 500)) {
			throw new NebiusRunClientError('The cancellation response could not be verified. Cancellation is not confirmed; refresh this saved run.', { uncertain: true });
		}
		if (error instanceof NebiusRunClientError) throw error;
		throw new NebiusRunClientError('The saved run could not be refreshed.');
	}
}

export function readRun(runId: string, runKey: string, packId: string, signal?: AbortSignal): Promise<RunRecord> {
	return requestKnownRun('GET', runId, runKey, packId, signal);
}

export function cancelRun(runId: string, runKey: string, packId: string, signal?: AbortSignal): Promise<RunRecord> {
	return requestKnownRun('DELETE', runId, runKey, packId, signal);
}

export async function downloadRunPreviewHtml(runId: string, runKey: string, signal?: AbortSignal): Promise<string> {
	try {
		authorization(runKey);
		return await withRequestDeadline(signal, async (requestSignal) => {
			const response = await fetch(`${endpoint(runId)}/preview`, {
				method: 'POST',
				cache: 'no-store',
				credentials: 'same-origin',
				headers: { Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
				body: new URLSearchParams({ key: runKey }).toString(),
				signal: requestSignal
			});
			if (!response.ok) {
				const value = await boundedJson(response);
				checkedResponse(response, value);
			}
			return boundedText(response, HTML_RESPONSE_LIMIT_BYTES, 'text/html');
		});
	} catch (error) {
		if (error instanceof NebiusRunClientError) throw error;
		throw new NebiusRunClientError('The complete tool could not be downloaded.');
	}
}
