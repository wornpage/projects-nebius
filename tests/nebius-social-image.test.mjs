import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { resolveSocialImageUrl, rewriteSocialImageMetadata, SOCIAL_IMAGE_PATH } from '../scripts/social-image-metadata.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imagePath = '/assets/og-image-511ed6d2.png';
const legacyImagePath = '/assets/og-image-7876d230.png';
const png = readFileSync(path.join(root, imagePath.slice(1)));

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test('social PNG has complete, valid 1200×630 image data', () => {
	assert.ok(createHash('sha256').update(png).digest('hex').startsWith('511ed6d2'), 'the image URL matches its content version');
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let offset = 8, header = null, ended = false;
  const imageData = [];
  while (offset < png.length) {
    assert.ok(offset + 12 <= png.length, 'every chunk has a complete header and checksum');
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    assert.ok(end <= png.length, 'every chunk fits inside the file');
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(crc32(png.subarray(offset + 4, offset + 8 + length)), png.readUInt32BE(end - 4), `${type} checksum`);
    if (offset === 8) assert.equal(type, 'IHDR');
    if (type === 'IHDR') {
      assert.equal(header, null, 'the image has one header');
      assert.equal(length, 13);
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], compression: data[10], filter: data[11], interlace: data[12] };
    }
    if (type === 'IDAT') imageData.push(data);
    offset = end;
    if (type === 'IEND') { assert.equal(length, 0); ended = true; break; }
  }
  assert.equal(ended, true, 'the PNG has an end chunk');
  assert.equal(offset, png.length, 'no incomplete or trailing data follows the end chunk');
  assert.equal(header.width, 1200);
  assert.equal(header.height, 630);
  assert.equal(header.depth, 8);
  assert.ok([2, 6].includes(header.color), 'the social image is RGB or RGBA');
  assert.equal(header.compression, 0);
  assert.equal(header.filter, 0);
  assert.equal(header.interlace, 0);
  assert.ok(imageData.length, 'the PNG contains image data');
  const decoded = inflateSync(Buffer.concat(imageData));
  const stride = 1 + header.width * (header.color === 6 ? 4 : 3);
  assert.equal(decoded.length, header.height * stride, 'all scanlines are present');
  for (let row = 0; row < header.height; row++) assert.ok(decoded[row * stride] <= 4, 'each scanline uses a valid PNG filter');
});

test('the previous social image URL retains the repaired image for older links', () => {
  assert.deepEqual(readFileSync(path.join(root, legacyImagePath.slice(1))), png);
});

test('the versioned image is immutable while the old URL revalidates', () => {
  const headers = readFileSync(path.join(root, 'svelte-frontend/static/_headers'), 'utf8').replaceAll('\r\n', '\n');
  function cacheControl(url) {
    const lines = headers.split('\n');
    const index = lines.indexOf(url);
    assert.ok(index >= 0, `${url} has a cache policy`);
    return lines[index + 1]?.trim() || '';
  }
  assert.match(cacheControl(imagePath), /^Cache-Control: public, max-age=31536000, immutable$/u);
  assert.match(cacheControl(legacyImagePath), /^Cache-Control: public, max-age=0, must-revalidate$/u);
});

function metaFor(file) {
  const document = parse(readFileSync(path.join(root, file), 'utf8'));
  const result = new Map();
  const keys = new Set(['og:image', 'og:image:width', 'og:image:height', 'og:image:type', 'og:image:alt', 'twitter:image', 'twitter:image:alt']);
  function visit(node) {
    if (node.nodeName === 'meta') {
      const attrs = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]));
      const key = attrs.property || attrs.name;
      if (keys.has(key)) { assert.equal(result.has(key), false, `${file} has one ${key} metadata tag`); result.set(key, attrs.content); }
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(document);
  return result;
}

test('landing and task metadata describe the same repaired social image', () => {
  for (const file of ['nebius-landing.html', 'svelte-frontend/src/app.html']) {
    const metadata = metaFor(file);
    assert.equal(metadata.get('og:image'), imagePath);
    assert.equal(metadata.get('twitter:image'), imagePath);
    assert.equal(metadata.get('og:image:width'), '1200');
    assert.equal(metadata.get('og:image:height'), '630');
    assert.equal(metadata.get('og:image:type'), 'image/png');
    assert.ok(metadata.get('og:image:alt')?.includes('Nemotron on Nebius'));
    assert.equal(metadata.get('twitter:image:alt'), metadata.get('og:image:alt'));
  }
});

test('a private build can omit the origin but a release build requires one', () => {
  assert.equal(resolveSocialImageUrl(undefined), null);
  assert.throws(() => resolveSocialImageUrl(undefined, { required: true }), /required for a release build/u);
  assert.equal(resolveSocialImageUrl('https://EXAMPLE.com:443/'), `https://example.com${SOCIAL_IMAGE_PATH}`);
  assert.equal(resolveSocialImageUrl('https://demo.example:8443'), `https://demo.example:8443${SOCIAL_IMAGE_PATH}`);
});

test('social release origins reject insecure URLs, paths, credentials and markup', () => {
  for (const value of ['', ' https://demo.example', 'https://demo.example ', 'http://demo.example', '//demo.example', 'demo.example',
    'https://user:password@demo.example', 'https://@demo.example', 'https://demo.example/path',
    'https://demo.example/foo/..', 'https://demo.example/.', 'https://demo.example/%2e', 'https://demo.example/?q=1',
    'https://demo.example/#fragment', 'https://demo.example/?', 'https://demo.example/#',
    'https://demo.example\\evil', 'https://demo.example" onload="bad', 'javascript:alert(1)']) {
    assert.throws(() => resolveSocialImageUrl(value), /HTTPS origin/u, value);
  }
});

test('only the two social-image attributes are rewritten', () => {
  const input = `<html><head><meta property="og:image" content="${SOCIAL_IMAGE_PATH}"><meta content='${SOCIAL_IMAGE_PATH}' name="twitter:image"><script>const x = "${SOCIAL_IMAGE_PATH}";</script></head><body><a href="${SOCIAL_IMAGE_PATH}">image</a></body></html>`;
  const absolute = resolveSocialImageUrl('https://demo.example');
  const result = rewriteSocialImageMetadata(input, absolute);
  assert.equal(result.found, true);
  assert.equal(result.html, input.replace(`content="${SOCIAL_IMAGE_PATH}"`, `content="${absolute}"`).replace(`content='${SOCIAL_IMAGE_PATH}'`, `content="${absolute}"`));
  assert.equal((result.html.match(/https:\/\/demo\.example\/assets\/og-image-511ed6d2\.png/gu) || []).length, 2);
  assert.deepEqual(rewriteSocialImageMetadata('<html><body>No metadata</body></html>', absolute), { html: '<html><body>No metadata</body></html>', found: false });
});

test('ambiguous or incomplete social metadata fails rather than emitting mixed URLs', () => {
  const absolute = resolveSocialImageUrl('https://demo.example');
  const og = `<meta property="og:image" content="${SOCIAL_IMAGE_PATH}">`;
  const twitter = `<meta name="twitter:image" content="${SOCIAL_IMAGE_PATH}">`;
  assert.throws(() => rewriteSocialImageMetadata(og, absolute), /both Open Graph and Twitter/u);
  assert.throws(() => rewriteSocialImageMetadata(og + og + twitter, absolute), /duplicate/u);
  assert.throws(() => rewriteSocialImageMetadata(og + '<meta name="twitter:image" content="/wrong.png">', absolute), /Unexpected/u);
});

test('landing copy describes the repair and second check as conditional', () => {
  const landing = readFileSync(path.join(root, 'nebius-landing.html'), 'utf8');
  assert.match(landing, /may try one repair\. If that repair passes validation, the checks can run again\./u);
  assert.doesNotMatch(landing, /gets one repair and another check/u);
});
