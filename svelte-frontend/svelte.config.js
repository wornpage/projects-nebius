import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));

const staticAdapter = {
	name: 'webmcp-challenge-static-adapter',
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
		experimental: { async: true }
	},
	kit: {
		adapter: staticAdapter,
		files: {
			assets: process.env.PROJECTS_SVELTE_ASSET_DIR || 'static'
		},
		version: { name: 'webmcp-challenge' },
		prerender: { entries: ['/webmcp-challenge', '/priority', '/work', '/review', '/next'] },
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'base-uri': ['none'],
				'object-src': ['none'],
				'frame-ancestors': ['none'],
				'frame-src': ['none'],
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
				'form-action': ['none']
			}
		}
	}
};

export default config;
