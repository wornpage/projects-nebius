import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'svelte-frontend');
const normalize = text => text.replaceAll('\r\n', '\n');
const notice = normalize(readFileSync(path.join(root, 'THIRD_PARTY_LICENSES.txt'), 'utf8'));
const rootLock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const frontendLock = JSON.parse(readFileSync(path.join(frontend, 'package-lock.json'), 'utf8'));

for (const { name, version, licensePath, packageRoot, lock } of [
  { name: 'clsx', version: '2.1.1', licensePath: 'license', packageRoot: frontend, lock: frontendLock },
  { name: 'parse5', version: '8.0.1', licensePath: 'LICENSE', packageRoot: root, lock: rootLock },
  { name: 'entities', version: '8.0.0', licensePath: 'LICENSE', packageRoot: root, lock: rootLock },
]) {
  test(`distributed notices retain the complete installed ${name} ${version} license`, () => {
    const packageDir = path.join(packageRoot, 'node_modules', name);
    const metadata = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
    assert.equal(metadata.version, version, 'the installed dependency must match the lockfile');
    const license = normalize(readFileSync(path.join(packageDir, licensePath), 'utf8'));
    assert.ok(license.trim(), 'the installed license must not be empty');
    assert.ok(notice.includes(license), `the complete installed ${name} license must be distributed`);
  });
}

for (const name of [
  'alert', 'async-states', 'binary-controls', 'command-surfaces', 'data-display',
  'dialog', 'disclosure', 'form-fields', 'layout-surfaces', 'receipt',
  'segmented-control', 'tabs', 'toast',
]) {
  test(`distributed notices retain the installed @wornpage/${name} license`, () => {
    const packageDir = path.join(frontend, 'node_modules', '@wornpage', name);
    const metadata = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const locked = frontendLock.packages[`node_modules/@wornpage/${name}`];
    assert.equal(metadata.version, locked.version, 'the installed dependency must match the lockfile');
    const license = normalize(readFileSync(path.join(packageDir, 'LICENSE'), 'utf8'));
    assert.ok(notice.includes(license), `the complete installed @wornpage/${name} license must be distributed`);
  });
}

test('the pinned button package disclosure retains its matched monorepo license', () => {
  const metadata = JSON.parse(readFileSync(path.join(frontend, 'node_modules/@wornpage/button/package.json'), 'utf8'));
  assert.equal(metadata.version, frontendLock.packages['node_modules/@wornpage/button'].version);
  assert.equal(metadata.license, 'MIT');
  const section = notice.split('@wornpage/button 0.2.2\n------------------------\n\n')[1]?.split('\nThe following packages contain the exact license below:')[0];
  assert.ok(section, 'the button package must have a separate disclosure');
  assert.match(section, /standalone archive declares MIT but contains no license file/u);
  assert.match(section, /seven src files match byte-for-byte the public components monorepo/u);
  assert.match(section, /db8b18d90ad8c140342e333d04e8555e82de111b/u);
  const licensedMonorepoNotice = normalize(readFileSync(path.join(frontend, 'node_modules/@wornpage/alert/LICENSE'), 'utf8'));
  assert.ok(section.includes(licensedMonorepoNotice), 'the exact matching monorepo license must be distributed');
  assert.match(section, /Verify that the final built artifact uses only those matched\nsource files/u);
});
