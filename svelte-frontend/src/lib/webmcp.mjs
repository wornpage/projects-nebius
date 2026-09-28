/** @typedef {{ registerTool?: (tool: object, options?: { signal?: AbortSignal }) => unknown }} WebMcpModelContext */
/** @typedef {{ modelContext?: WebMcpModelContext }} WebMcpDocument */
/** @typedef {'connecting' | 'ready' | 'unavailable' | 'error'} WebMcpCatalogStatus */
/** @typedef {'read-only' | 'page-changing-or-draft'} WebMcpToolAuthority */
/** @typedef {{ name: string, description: string, authority: WebMcpToolAuthority }} WebMcpCatalogTool */
/** @typedef {{ status: WebMcpCatalogStatus, tools: readonly WebMcpCatalogTool[] }} WebMcpCatalogState */

const EMPTY_CATALOG = Object.freeze({ status: /** @type {WebMcpCatalogStatus} */ ('connecting'), tools: Object.freeze([]) });
/** @type {WebMcpCatalogState} */
let catalogState = EMPTY_CATALOG;
/** @type {Set<(state: WebMcpCatalogState) => void>} */
const catalogSubscribers = new Set();
/** @type {symbol | null} */
let currentCatalogSession = null;

export const webMcpCatalog = Object.freeze({
	/** @param {(state: WebMcpCatalogState) => void} subscriber */
	subscribe(subscriber) {
		if (typeof subscriber !== 'function') throw new TypeError('WebMCP catalog subscription requires a function.');
		catalogSubscribers.add(subscriber);
		subscriber(catalogState);
		return () => {
			catalogSubscribers.delete(subscriber);
		};
	}
});

/** @returns {WebMcpCatalogState} */
export function getWebMcpCatalogSnapshot() {
	return catalogState;
}

/** @param {WebMcpCatalogState} nextState */
function publishCatalog(nextState) {
	catalogState = Object.freeze({
		status: nextState.status,
		tools: Object.freeze(nextState.tools.map((tool) => Object.freeze({ ...tool })))
	});
	for (const subscriber of catalogSubscribers) subscriber(catalogState);
}

/**
 * Register the complete tool set owned by one rendered page. One abort signal
 * owns the set so client-side navigation or any registration failure cannot
 * leave a partial catalog alive. Unsupported browsers retain the ordinary
 * page and do not inspect tools.
 *
 * @param {unknown} documentRef
 * @param {unknown} tools
 * @param {{
 *   onError?: (error: unknown, toolName: string) => void,
 *   onInvocationError?: (invocation: { toolName: string, toolTitle: string, error: unknown }) => unknown,
 *   onResult?: (invocation: { toolName: string, toolTitle: string, result: unknown }) => unknown
 * }} [options]
 * @returns {() => void}
 */
export function registerPageTools(documentRef, tools, {
	onError = (error, toolName) => console.error(`WebMCP registration failed for ${toolName}.`, error),
	onInvocationError = () => {},
	onResult = () => {}
} = {}) {
	const pageDocument = /** @type {WebMcpDocument | null | undefined} */ (documentRef);
	const modelContext = pageDocument?.modelContext;
	if (!Array.isArray(tools)) throw new TypeError('WebMCP requires an array of tool descriptors.');
	if (tools.length === 0) throw new TypeError('WebMCP requires at least one tool descriptor.');
	if (typeof onInvocationError !== 'function') throw new TypeError('WebMCP invocation error handling requires a function.');
	if (typeof onResult !== 'function') throw new TypeError('WebMCP result handling requires a function.');

	const descriptors = tools.map((tool) => {
		if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
			throw new TypeError('WebMCP requires an executable tool descriptor.');
		}
		const descriptor = /** @type {Record<string, unknown>} */ (tool);
		if (typeof descriptor.name !== 'string' || !descriptor.name.trim() || typeof descriptor.execute !== 'function') {
			throw new TypeError('WebMCP requires an executable tool descriptor.');
		}
		return { descriptor, name: descriptor.name.trim() };
	});
	if (new Set(descriptors.map(({ name }) => name)).size !== descriptors.length) {
		throw new TypeError('WebMCP page tool names must be unique tool names.');
	}
	const catalogTools = descriptors.map(({ descriptor, name }) => {
		if (typeof descriptor.description !== 'string' || !descriptor.description.trim()) {
			throw new TypeError('WebMCP catalog tools require descriptions.');
		}
		const annotations = descriptor.annotations;
		const readOnly = !!annotations && typeof annotations === 'object' && !Array.isArray(annotations)
			&& /** @type {Record<string, unknown>} */ (annotations).readOnlyHint === true;
		return {
			name,
			description: descriptor.description,
			authority: /** @type {WebMcpToolAuthority} */ (readOnly ? 'read-only' : 'page-changing-or-draft')
		};
	});
	const catalogSession = Symbol('webmcp-page-catalog');
	currentCatalogSession = catalogSession;
	if (typeof modelContext?.registerTool !== 'function') {
		publishCatalog({ status: 'unavailable', tools: catalogTools });
		return () => {
			if (currentCatalogSession !== catalogSession) return;
			currentCatalogSession = null;
			publishCatalog(EMPTY_CATALOG);
		};
	}

	const registrationController = new AbortController();
	publishCatalog({ status: 'connecting', tools: catalogTools });
	/** @param {unknown} error @param {string} toolName */
	const failPageRegistration = (error, toolName) => {
		if (registrationController.signal.aborted) return;
		registrationController.abort();
		if (currentCatalogSession === catalogSession) {
			publishCatalog({ status: 'error', tools: catalogTools });
		}
		onError(error, toolName);
	};
	/** @type {Promise<unknown>[]} */
	const registrationPromises = [];
	for (const { descriptor, name } of descriptors) {
		const execute = /** @type {(...args: any[]) => unknown} */ (descriptor.execute);
		const registeredDescriptor = {
			...descriptor,
			/** @param {unknown} input @param {unknown} invocationOptions */
			async execute(input, invocationOptions) {
				const toolTitle = typeof descriptor.title === 'string' ? descriptor.title : name;
				try {
					const result = await execute.call(descriptor, input, invocationOptions);
					if (!registrationController.signal.aborted) {
						await onResult({ toolName: name, toolTitle, result });
					}
					return result;
				} catch (error) {
					if (!registrationController.signal.aborted) {
						await onInvocationError({ toolName: name, toolTitle, error });
					}
					throw error;
				}
			}
		};
		try {
			registrationPromises.push(Promise.resolve(modelContext.registerTool(registeredDescriptor, {
				signal: registrationController.signal
			})).catch((error) => {
				failPageRegistration(error, name);
				throw error;
			}));
		} catch (error) {
			failPageRegistration(error, name);
			break;
		}
	}
	void Promise.all(registrationPromises).then(() => {
		if (!registrationController.signal.aborted && currentCatalogSession === catalogSession) {
			publishCatalog({ status: 'ready', tools: catalogTools });
		}
	}).catch(() => {});

	return () => {
		registrationController.abort();
		if (currentCatalogSession !== catalogSession) return;
		currentCatalogSession = null;
		publishCatalog(EMPTY_CATALOG);
	};
}
