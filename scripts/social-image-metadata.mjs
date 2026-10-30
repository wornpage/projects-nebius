import { parse } from 'parse5';

export const SOCIAL_IMAGE_PATH = '/assets/og-image-511ed6d2.png';

export function resolveSocialImageUrl(origin, { required = false } = {}) {
	if (origin === undefined) {
		if (required) throw new Error('NEBIUS_PUBLIC_ORIGIN is required for a release build.');
		return null;
	}
	if (typeof origin !== 'string' || !origin || origin.trim() !== origin || /[\s\\?#@]/u.test(origin) || !/^https:\/\/[^/]+\/?$/iu.test(origin)) {
		throw new Error('NEBIUS_PUBLIC_ORIGIN must be an HTTPS origin without a path, query, fragment or credentials.');
	}
	let parsed;
	try { parsed = new URL(origin); } catch {
		throw new Error('NEBIUS_PUBLIC_ORIGIN must be an HTTPS origin without a path, query, fragment or credentials.');
	}
	if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
		throw new Error('NEBIUS_PUBLIC_ORIGIN must be an HTTPS origin without a path, query, fragment or credentials.');
	}
	return `${parsed.origin}${SOCIAL_IMAGE_PATH}`;
}

// Change only the two image metadata attributes. Parsing supplies exact source
// offsets so the rest of the generated HTML, including inline scripts, is kept.
export function rewriteSocialImageMetadata(html, imageUrl, { expectedImage = SOCIAL_IMAGE_PATH } = {}) {
	const document = parse(html, { sourceCodeLocationInfo: true });
	const tags = new Map();
	function visit(node) {
		if (node.nodeName === 'meta') {
			const attrs = Object.fromEntries(node.attrs.map((attr) => [attr.name, attr.value]));
			const key = attrs.property || attrs.name;
			if (key === 'og:image' || key === 'twitter:image') {
				if (tags.has(key) || attrs.content !== expectedImage || !node.sourceCodeLocation?.attrs?.content) {
					throw new Error(`Unexpected or duplicate ${key} metadata.`);
				}
				tags.set(key, node.sourceCodeLocation.attrs.content);
			}
		}
		for (const child of node.childNodes || []) visit(child);
	}
	visit(document);
	if (tags.size === 0) return { html, found: false };
	if (tags.size !== 2 || !tags.has('og:image') || !tags.has('twitter:image')) {
		throw new Error('Expected both Open Graph and Twitter image metadata.');
	}
	const escaped = imageUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
	const ranges = [...tags.values()].sort((a, b) => b.startOffset - a.startOffset);
	for (const range of ranges) {
		html = `${html.slice(0, range.startOffset)}content="${escaped}"${html.slice(range.endOffset)}`;
	}
	return { html, found: true };
}
