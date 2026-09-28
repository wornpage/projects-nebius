import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

// Dev and preview serve the same canonical root assets that the production
// aggregate contains. Production prerendering receives that aggregate through
// PROJECTS_SVELTE_ASSET_DIR in scripts/build-svelte-frontend.mjs.
const repoRootLanding = here('../landing.html');
const repoRootAssets = here('../assets');
const repoRootManifest = here('../manifest.json');
const repoRootData = here('../data');

const mime: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.html': 'text/html; charset=utf-8'
};

function repoAssetsMiddleware(
	req: IncomingMessage,
	res: ServerResponse,
	next: () => void
) {
	let pathname: string;
	try {
		pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
	} catch {
		res.statusCode = 400;
		res.end('Bad request');
		return;
	}
	const isLanding = pathname === '/' || pathname === '/landing.html';
	const isManifest = pathname === '/manifest.json';
	const isData = pathname === '/data/demo-packs.json';
	if (!isLanding && !isManifest && !pathname.startsWith('/assets/') && !isData) return next();
	const root = isData ? repoRootData : repoRootAssets;
	const rel = isManifest || isLanding ? '' : isData ? 'demo-packs.json' : pathname.slice('/assets/'.length);
	const target = isLanding ? repoRootLanding : isManifest ? repoRootManifest : resolve(normalize(join(root, rel)));
	const relativeTarget = isManifest || isLanding ? '' : relative(root, target);
	const insideRoot = isManifest || isLanding || (relativeTarget !== '..' && !relativeTarget.startsWith(`..${sep}`) && !isAbsolute(relativeTarget));

	if (!insideRoot) {
		res.statusCode = 403;
		res.end('Forbidden');
		return;
	}
	if (!existsSync(target) || !statSync(target).isFile()) {
		res.statusCode = 404;
		res.end('Not found');
		return;
	}
	res.setHeader('Content-Type', mime[extname(target).toLowerCase()] || 'application/octet-stream');
	res.end(readFileSync(target));
}

export default defineConfig({
	define: { __NEBIUS_EDITION__: JSON.stringify(process.env.PROJECTS_NEBIUS_EDITION === 'true') },
	cacheDir: 'node_modules/.vite',
	build: {
		rolldownOptions: {
			checks: { pluginTimings: false }
		}
	},
	plugins: [
		sveltekit(),
		{
			name: 'repo-root-assets',
			configureServer(server) {
				server.middlewares.use(repoAssetsMiddleware);
			},
			configurePreviewServer(server) {
				server.middlewares.use(repoAssetsMiddleware);
			}
		}
	]
});
