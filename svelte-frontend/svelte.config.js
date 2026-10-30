import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { createCssHash } from './svelte-css-hash.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));

const staticAdapter = {
	name: 'nebius-static-adapter',
	async adapt(builder) {
		const output = here('../dist/static-publish');
		builder.writeClient(output);
		builder.writePrerendered(output);
	}
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		rootDir: here('.'),
		cssHash: createCssHash(here('.')),
		experimental: { async: true }
	},
	kit: {
		appDir: '_app-r191',
		adapter: staticAdapter,
		files: {
			assets: process.env.PROJECTS_SVELTE_ASSET_DIR || 'static'
		},
		version: { name: 'projects-nebius' },
		prerender: { entries: ['/webmcp-challenge', '/priority', '/work', '/review', '/next', '/guide', '/grounding-rehearsal', '/recovery-rehearsal'] },
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'base-uri': ['none'],
				'object-src': ['none'],
				'frame-ancestors': ['none'],
				'frame-src': ['self'],
				'worker-src': ['self'],
				'script-src': ['self'],
				'style-src': [
					'self',
					'unsafe-hashes',
					'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo='
				],
				'font-src': ['self'],
				'img-src': ['self', 'data:'],
				'media-src': ['none'],
				'manifest-src': ['self'],
				'connect-src': ['self'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
