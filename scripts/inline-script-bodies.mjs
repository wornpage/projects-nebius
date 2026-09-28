import { parse } from 'parse5';

function readScriptBody(node) {
	return (node.childNodes ?? [])
		.filter((child) => child.nodeName === '#text')
		.map((child) => child.value)
		.join('');
}

export function collectInlineScriptBodies(html) {
	const bodies = [];
	const visit = (node) => {
		if (node.nodeName === 'script') {
			const hasSource = (node.attrs ?? []).some((attribute) => attribute.name === 'src');
			const body = readScriptBody(node);
			if (!hasSource && body.trim()) bodies.push(body);
		}
		for (const child of node.childNodes ?? []) visit(child);
	};

	visit(parse(html));
	return bodies;
}
