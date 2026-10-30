import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

for (const file of ['package-lock.json', 'svelte-frontend/package-lock.json']) {
  test(`${file} pins package downloads and integrity`, async () => {
    const lock = JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url), 'utf8'));
    assert.equal(lock.lockfileVersion, 3);
    const packages = Object.entries(lock.packages).filter(([name]) => name !== '');
    assert(packages.length > 0);
    for (const [name, entry] of packages) {
      assert.equal(entry.link, undefined, `${name} must not use a local link`);
      assert.equal(typeof entry.version, 'string', `${name} must have a version`);
      assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u, `${name} must have a package checksum`);
      const resolved = new URL(entry.resolved);
      assert.equal(resolved.protocol, 'https:');
      assert.equal(resolved.username, ''); assert.equal(resolved.password, '');
      assert.equal(resolved.search, ''); assert.equal(resolved.hash, '');
      assert(['registry.npmjs.org', 'codeload.github.com'].includes(resolved.hostname), `${name} has an unexpected package host`);
      if (resolved.hostname === 'codeload.github.com') assert.match(resolved.pathname, /^\/wornpage\/[^/]+\/tar\.gz\/[a-f0-9]{40}$/u);
    }
  });
}
