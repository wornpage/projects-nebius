import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectFiles(directory, extension, files = []) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) collectFiles(absolute, extension, files);
		else if (entry.isFile() && entry.name.endsWith(extension)) files.push(absolute);
	}
	return files;
}

function relative(absolute) {
	return path.relative(root, absolute).split(path.sep).join('/');
}

function normalizeCssEscapes(source) {
	return source.replace(
		/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|((?:\r\n)|[\n\f\r])|(.))/giu,
		(_escape, hexadecimal, newline, character) => {
			if (hexadecimal) {
				const codePoint = Number.parseInt(hexadecimal, 16);
				return codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
					? '\ufffd'
					: String.fromCodePoint(codePoint);
			}
			if (newline) return '';
			return character;
		}
	);
}

function sideBorderWidths(source) {
	const widths = [];
	const normalized = normalizeCssEscapes(source);
	for (const match of normalized.matchAll(/\bborder-(?:left|right|inline-start|inline-end)(?:-width)?\s*:\s*([^;{}]+)/giu)) {
		for (const width of match[1].matchAll(/(-?(?:\d+|\d*\.\d+))px\b/giu)) widths.push(Number(width[1]));
	}
	return widths;
}

function shadowLayers(value) {
	const layers = [[]];
	let token = '';
	let depth = 0;
	const finishToken = () => {
		if (token) layers.at(-1).push(token);
		token = '';
	};

	for (const character of value) {
		if (character === '(') depth += 1;
		else if (character === ')') depth = Math.max(0, depth - 1);

		if (depth === 0 && (character === ',' || /\s/u.test(character))) {
			finishToken();
			if (character === ',') layers.push([]);
		} else {
			token += character;
		}
	}
	finishToken();
	return layers.filter((layer) => layer.length > 0);
}

function pixelLength(token) {
	const match = token.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(px)?$/iu);
	if (!match) return null;
	const value = Number(match[1]);
	return match[2] || value === 0 ? value : null;
}

function horizontalInsetRails(source) {
	const rails = [];
	const normalized = normalizeCssEscapes(source);
	for (const declaration of normalized.matchAll(/\bbox-shadow\s*:\s*([^;}]+)/giu)) {
		for (const tokens of shadowLayers(declaration[1])) {
			if (!tokens.some((token) => /^inset$/iu.test(token))) continue;
			const lengths = tokens.map(pixelLength).filter((length) => length !== null);
			if (lengths.length < 2 || lengths.length > 4) continue;

			const [offsetX, offsetY, blurRadius = 0, spreadRadius = 0] = lengths;
			const sideWidth = Math.max(0, Math.abs(offsetX) + spreadRadius);
			if (offsetX !== 0 && offsetY === 0 && blurRadius === 0 && sideWidth >= 2) {
				rails.push(tokens.join(' '));
			}
		}
	}
	return rails;
}

function fullBorderViolations(source) {
	return {
		wideSides: sideBorderWidths(source).filter((width) => Math.abs(width) > 1),
		insetRails: horizontalInsetRails(source)
	};
}

test('the Full Border Rule scanner rejects physical, logical, escaped, decimal, and inset side rails', () => {
	const violations = fullBorderViolations(String.raw`
		.escaped-left { border-\6c eft: 2px solid red; }
		.physical-right { border-right-width: 2.25px; }
		.logical-start { border-inline-start: -2px solid red; }
		.logical-end { border-inline-end-width: -2.5px; }
		.prefix-inset { box-shadow: inset 3.5px 0 0 red; }
		.suffix-inset { box-shadow: 3px 0 0 red inset; }
		.interleaved-inset { box-shadow: 2.25px 0 inset 0 red; }
		.multiple-layers { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18), -4px 0.0px -0px var(--rail) inset; }
		.spread-shaped-rail { box-shadow: 1px 0 0 1px inset color-mix(in srgb, red 60%, transparent); }
		.decimal-right-rail { box-shadow: -3.25px 0 0 -1.25px inset red; }
	`);

	assert.deepEqual(violations.wideSides, [2, 2.25, -2, -2.5]);
	assert.deepEqual(violations.insetRails, [
		'inset 3.5px 0 0 red',
		'3px 0 0 red inset',
		'2.25px 0 inset 0 red',
		'-4px 0.0px -0px var(--rail) inset',
		'1px 0 0 1px inset color-mix(in srgb, red 60%, transparent)',
		'-3.25px 0 0 -1.25px inset red'
	]);
});

test('the Full Border Rule scanner accepts neutral 1px separators and non-side shadows', () => {
	const violations = fullBorderViolations(`
		.physical { border-left: 1px solid var(--border); border-right-width: 1px; }
		.logical { border-inline-start: 1px solid var(--border); border-inline-end-width: 1px; }
		.one-pixel-inset { box-shadow: inset 1px 0 0 var(--border), -1px 0 0 var(--border) inset; }
		.spread-reduced-inset { box-shadow: 2px 0 0 -1px inset var(--border); }
		.elevated { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); }
		.non-inset-horizontal { box-shadow: 4px 0 0 red; }
		.vertical-inset { box-shadow: inset 0 1px 0 var(--border), inset 0 -1px 0 var(--border); }
	`);

	assert.deepEqual(violations, { wideSides: [], insetRails: [] });
});

test('the Full Border Rule covers every authored extension CSS and Svelte source', () => {
	const sources = [
		...collectFiles(path.join(root, 'assets'), '.css'),
		...collectFiles(path.join(root, 'svelte-frontend', 'src'), '.svelte')
	].sort((left, right) => left.localeCompare(right));

	assert.ok(sources.length > 0, 'authored style source set is not empty');
	assert.ok(sources.some((file) => relative(file) === 'assets/demo.css'));
	assert.ok(sources.some((file) => relative(file) === 'assets/landing.css'));
	assert.ok(sources.some((file) => relative(file) === 'svelte-frontend/src/lib/components/WorkGridCard.svelte'));

	const violations = sources.flatMap((file) => {
		const source = readFileSync(file, 'utf8');
		const { wideSides, insetRails } = fullBorderViolations(source);
		return wideSides.length || insetRails.length
			? [{ file: relative(file), wideSides, insetRails }]
			: [];
	});

	assert.deepEqual(violations, []);
});

test('the extension design contract documents the Full Border Rule', () => {
	const design = readFileSync(path.join(root, 'DESIGN.md'), 'utf8');
	assert.match(design, /five task routes/iu);
	assert.match(design, /supported light and dark color schemes/iu);
	assert.match(design, /Full Border Rule/u);
	assert.match(design, /full 1px borders or background tints/iu);
	assert.match(design, /never a colored side stripe/iu);
});
