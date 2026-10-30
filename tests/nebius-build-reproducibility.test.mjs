import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { createCssHash } from '../svelte-frontend/svelte-css-hash.mjs';
import config from '../svelte-frontend/svelte.config.js';

const require = createRequire(new URL('../svelte-frontend/package.json', import.meta.url));
const { compile } = require('svelte/compiler');
const source = '<button>Action</button><style>button { color: red; }</style>';
const roots = ['/checkout/one/svelte-frontend', '/different/checkout/two/svelte-frontend'];

function compiled(rootDir, filename, input = source) {
	// Svelte strips rootDir by string prefix. Keep the directory boundary explicit,
	// as the production config does, so sibling directories remain outside it.
	return compile(input, {
		filename, rootDir: `${rootDir.replace(/[\\/]+$/u, '')}/`,
		cssHash: createCssHash(rootDir), generate: 'client'
	});
}

function scope(result) {
	const value = result.css.code.match(/svelte-[a-f0-9]{64}/u)?.[0];
	assert.ok(value, 'compiler emits the deterministic scope in CSS');
	assert.ok(result.js.code.includes(value), 'compiler applies the same scope to component markup');
	return value;
}

test('real Svelte compilation preserves CSS and JS across two checkout roots', () => {
	const results = roots.map(root => compiled(root, `${root}/src/lib/Action.svelte`));
	assert.equal(scope(results[0]), scope(results[1]));
	assert.equal(results[0].css.code, results[1].css.code);
	assert.equal(results[0].js.code, results[1].js.code);
});

test('absolute, root-relative and Windows source filenames have the same scope', () => {
	const hashes = [
		compiled(roots[0], `${roots[0]}/src/lib/Action.svelte`),
		compiled(roots[0], 'src/lib/Action.svelte'),
		compiled('C:/checkout/svelte-frontend', 'C:\\checkout\\svelte-frontend\\src\\lib\\Action.svelte'),
		compiled('D:\\other\\svelte-frontend', 'src\\lib\\Action.svelte'),
		compiled('C:/CHECKOUT/svelte-frontend', 'c:/checkout/svelte-frontend/src/lib/Action.svelte'),
		compiled('\\\\server\\share\\svelte-frontend', '\\\\server\\share\\svelte-frontend\\src\\lib\\Action.svelte')
	].map(scope);
	assert.equal(new Set(hashes).size, 1);
});

test('dependency realpaths and nested node_modules preserve package-qualified identity', () => {
	const filenames = [
		`${roots[0]}/node_modules/@wornpage/button/src/Action.svelte`,
		'/external/installation/node_modules/@wornpage/button/src/Action.svelte',
		'C:\\packet\\dependencies\\node_modules\\@wornpage\\button\\src\\Action.svelte',
		'/installation/node_modules/parent/node_modules/@wornpage/button/src/Action.svelte',
		'/installation/node_modules/.pnpm/button@1.0/node_modules/@wornpage/button/src/Action.svelte',
		'node_modules/@wornpage/button/src/Action.svelte'
	];
	assert.equal(new Set(filenames.map(filename => scope(compiled(roots[0], filename)))).size, 1);
	assert.equal(
		scope(compiled(roots[0], '/first/node_modules/button/src/Action.svelte')),
		scope(compiled(roots[1], '/second/node_modules/parent/node_modules/button/src/Action.svelte'))
	);
});

test('identical CSS retains distinct component, package, scope and project identities', () => {
	const filenames = [
		'src/lib/Action.svelte', 'src/lib/Other.svelte', 'src/elsewhere/Action.svelte',
		'node_modules/button/src/Action.svelte', 'node_modules/other/src/Action.svelte',
		'node_modules/@one/button/src/Action.svelte', 'node_modules/@two/button/src/Action.svelte',
		'node_modules/@one/button/other/Action.svelte'
	];
	assert.equal(new Set(filenames.map(filename => scope(compiled(roots[0], filename)))).size, filenames.length);
});

test('CSS changes alter the scope of the same component', () => {
	assert.notEqual(
		scope(compiled(roots[0], 'src/lib/Action.svelte')),
		scope(compiled(roots[0], 'src/lib/Action.svelte', source.replace('red', 'blue')))
	);
});

test('production config uses the same explicit root and compiler callback', () => {
	const root = fileURLToPath(new URL('../svelte-frontend/', import.meta.url));
	assert.equal(config.compilerOptions.rootDir, root);
	const filename = `${root}src/lib/Action.svelte`;
	const result = compile(source, { ...config.compilerOptions, filename, generate: 'client' });
	assert.equal(scope(result), scope(compiled(roots[0], 'src/lib/Action.svelte')));
	const dependency = realpathSync(`${root}node_modules/@wornpage/button/src/WornButton.svelte`);
	assert.equal(
		scope(compile(source, { ...config.compilerOptions, filename: dependency })),
		scope(compiled(roots[0], 'node_modules/@wornpage/button/src/WornButton.svelte'))
	);
});

test('unsupported filenames fail clearly in real Svelte compilation', () => {
	for (const filename of [
		'(unknown)', '/outside/Action.svelte', `${roots[0]}-sibling/Action.svelte`,
		'../Action.svelte', 'src/../../Action.svelte', 'file:///outside/Action.svelte',
		'C:Action.svelte', '\u0000virtual.svelte', 'src/Action.svelte?query',
		'node_modules/@scope/Action.svelte', 'node_modules/.hidden/Action.svelte',
		'node_modules/button'
	]) {
		assert.throws(() => compiled(roots[0], filename), /Cannot identify Svelte CSS/u, filename);
	}
	assert.throws(() => compile(source, { rootDir: roots[0], cssHash: createCssHash(roots[0]) }), /Cannot identify Svelte CSS/u);
});

test('invalid callback inputs cannot silently supply a scope', () => {
	assert.throws(() => createCssHash('relative/root'), /project root must be absolute/u);
	const hash = createCssHash(roots[0]);
	for (const filename of [undefined, null, '', '(unknown)']) {
		assert.throws(() => hash({ filename, css: '' }), /Cannot identify Svelte CSS/u);
	}
	assert.throws(() => hash({ filename: 'src/Action.svelte', css: undefined }), /contents must be a string/u);
});
