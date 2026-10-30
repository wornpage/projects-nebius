import { createHash } from 'node:crypto';
import { posix } from 'node:path';

const absolute = (path) => path.startsWith('/') || /^[a-z]:\//i.test(path);

function normalizedPath(value) {
	if (typeof value !== 'string' || !value || value === '(unknown)' || /[\0?#]/u.test(value)) {
		throw new Error('Cannot identify Svelte CSS filename: expected a concrete filesystem path');
	}
	const path = value.replaceAll('\\', '/');
	if (path.includes(':') && !/^[a-z]:\//i.test(path)) {
		throw new Error(`Cannot identify Svelte CSS filename: unsupported path ${value}`);
	}
	return posix.normalize(path);
}

/**
 * Svelte passes filenames relative to compilerOptions.rootDir when possible.
 * Dependencies may instead be realpaths in another installation. Their last
 * node_modules boundary identifies the owning package independent of hoisting.
 * @param {string} projectRoot The same absolute directory as compilerOptions.rootDir.
 * @returns {NonNullable<import('svelte/compiler').CompileOptions['cssHash']>}
 */
export function createCssHash(projectRoot) {
	const root = normalizedPath(projectRoot).replace(/\/$/u, '');
	if (!absolute(root)) throw new Error('Svelte CSS project root must be absolute');
	const windowsRoot = /^[a-z]:\//i.test(root) || projectRoot.replaceAll('\\', '/').startsWith('//');

	return ({ filename, css }) => {
		const path = normalizedPath(filename);
		const parts = path.split('/');
		const packageBoundary = parts.lastIndexOf('node_modules');
		let identity;
		if (packageBoundary !== -1) {
			const packageParts = parts.slice(packageBoundary + 1);
			const scoped = packageParts[0]?.startsWith('@');
			const nameParts = packageParts.splice(0, scoped ? 2 : 1);
			const validName = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(value);
			if (!validName(scoped ? nameParts[0]?.slice(1) : nameParts[0]) ||
				(scoped && !validName(nameParts[1])) || !packageParts.length) {
				throw new Error(`Cannot identify Svelte CSS package component: ${filename}`);
			}
			identity = `package:${nameParts.join('/')}/${packageParts.join('/')}`;
		} else {
			const prefix = `${root}/`;
			const insideRoot = windowsRoot
				? path.toLowerCase().startsWith(prefix.toLowerCase())
				: path.startsWith(prefix);
			const relative = insideRoot ? path.slice(prefix.length) : path;
			if (absolute(relative) || relative === '.' || relative === '..' || relative.startsWith('../')) {
				throw new Error(`Cannot identify Svelte CSS component outside project root: ${filename}`);
			}
			identity = `project:${relative}`;
		}
		if (typeof css !== 'string') throw new Error('Svelte CSS contents must be a string');
		return `svelte-${createHash('sha256').update(JSON.stringify([identity, css])).digest('hex')}`;
	};
}
