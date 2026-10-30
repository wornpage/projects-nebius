import test from 'node:test';
import assert from 'node:assert/strict';
import { requestTextDiff } from '../svelte-frontend/src/lib/nebius-request-diff.mjs';

const texts = (diff, kind) => diff.segments.filter(segment => segment.kind === kind).map(segment => segment.text).join('');
const reconstruct = (diff, side) => diff.segments.filter(segment => segment.kind !== (side === 'saved' ? 'added' : 'removed')).map(segment => segment.text).join('');

test('word additions, removals and replacements retain exact originals and reconstruct each side', () => {
  for (const [saved, current] of [['Read report', 'Read the report'], ['Read the report', 'Read report'], ['Read old report', 'Read new report']]) {
    const diff = requestTextDiff(saved, current);
    assert.equal(diff.status, 'compared');
    assert.equal(diff.saved, saved);
    assert.equal(diff.current, current);
    assert.equal(reconstruct(diff, 'saved'), saved);
    assert.equal(reconstruct(diff, 'current'), current);
  }
  assert.equal(texts(requestTextDiff('old', 'new'), 'removed'), 'old');
  assert.equal(texts(requestTextDiff('old', 'new'), 'added'), 'new');
});

test('empty and unchanged strings retain literal values without placeholders', () => {
  for (const [saved, current] of [['', 'new'], ['old', ''], ['', ''], ['same', 'same']]) {
    const diff = requestTextDiff(saved, current);
    assert.equal(diff.status, saved === current ? 'unchanged' : 'compared');
    assert.equal(reconstruct(diff, 'saved'), saved);
    assert.equal(reconstruct(diff, 'current'), current);
    assert.equal(diff.saved, saved);
    assert.equal(diff.current, current);
  }
});

test('punctuation is compared without swallowing adjacent text', () => {
  const diff = requestTextDiff('Ready, now.', 'Ready? now!');
  assert.equal(reconstruct(diff, 'saved'), 'Ready, now.');
  assert.equal(reconstruct(diff, 'current'), 'Ready? now!');
  assert.match(texts(diff, 'removed'), /,/);
  assert.match(texts(diff, 'added'), /\?/);
});

test('whitespace-only changes preserve spaces, tabs and line endings', () => {
  for (const [saved, current] of [['a b', 'a  b'], ['\t\n', ' \r\n'], ['', '\t'], ['line\r\nnext', 'line\nnext']]) {
    const diff = requestTextDiff(saved, current);
    assert.equal(diff.whitespaceOnly, true);
    assert.equal(reconstruct(diff, 'saved'), saved);
    assert.equal(reconstruct(diff, 'current'), current);
  }
  assert.equal(requestTextDiff('old', 'new').whitespaceOnly, false);
  assert.equal(requestTextDiff(' ', ' ').whitespaceOnly, false);
});

test('Unicode and HTML-like text stay literal and exact', () => {
  const saved = '<img src=x onerror="alert(1)"> café 👩🏽‍💻 東京';
  const current = '<script>alert("new")</script> café 🧑🏽‍💻 京都';
  const diff = requestTextDiff(saved, current);
  assert.equal(reconstruct(diff, 'saved'), saved);
  assert.equal(reconstruct(diff, 'current'), current);
  assert.equal(diff.saved, saved);
  assert.equal(diff.current, current);
  assert.equal(texts(requestTextDiff('', current), 'added'), current);
});

test('long unchanged edges keep exactly 80 Unicode code points on each side', () => {
  const prefix = '😀 '.repeat(100);
  const suffix = ' 🐱'.repeat(100);
  const diff = requestTextDiff(`${prefix}old${suffix}`, `${prefix}new${suffix}`);
  const contexts = diff.segments.filter(segment => segment.kind === 'unchanged');
  assert.deepEqual(contexts.map(segment => [...segment.text].length), [80, 80]);
  assert.equal(contexts[0].text, [...prefix].slice(-80).join(''));
  assert.equal(contexts[1].text, [...suffix].slice(0, 80).join(''));
  assert.deepEqual(diff.segments.filter(segment => segment.kind === 'omission').map(segment => segment.count), [120, 120]);
  assert.equal(diff.saved, `${prefix}old${suffix}`);
  assert.equal(diff.current, `${prefix}new${suffix}`);
});

test('overlapping context windows merge without duplicated unchanged text', () => {
  const middle = ` ${'context '.repeat(18)}`;
  const diff = requestTextDiff(`old${middle}old`, `new${middle}new`);
  assert.ok([...middle].length > 80 && [...middle].length <= 160);
  assert.equal(diff.segments.some(segment => segment.kind === 'omission'), false);
  assert.equal(texts(diff, 'unchanged'), middle);
  assert.equal(reconstruct(diff, 'saved'), `old${middle}old`);
  assert.equal(reconstruct(diff, 'current'), `new${middle}new`);
});

test('separate context windows omit only the middle of a long unchanged span', () => {
  const middle = ` ${'context '.repeat(40)}`;
  const diff = requestTextDiff(`old${middle}old`, `new${middle}new`);
  assert.deepEqual(diff.segments.filter(segment => segment.kind === 'omission'), [{ kind: 'omission', count: [...middle].length - 160 }]);
  assert.deepEqual(diff.segments.filter(segment => segment.kind === 'unchanged').map(segment => segment.text), [[...middle].slice(0, 80).join(''), [...middle].slice(-80).join('')]);
});

test('maximum 4000-character prose remains complete in originals with compact context', () => {
  const saved = `${'a '.repeat(1999)}no`;
  const current = `${'a '.repeat(1999)}ok`;
  assert.equal(saved.length, 4000);
  const diff = requestTextDiff(saved, current);
  assert.equal(diff.status, 'compared');
  assert.equal(diff.saved, saved);
  assert.equal(diff.current, current);
  assert.equal(texts(diff, 'unchanged').length, 80);
  assert.equal(texts(diff, 'removed'), 'no');
  assert.equal(texts(diff, 'added'), 'ok');
});

test('more than 512 word edits cuts off without any partial highlights', t => {
  t.mock.method(Date, 'now', () => 0);
  const saved = 'old '.repeat(600);
  const current = 'new '.repeat(600);
  const diff = requestTextDiff(saved, current);
  assert.equal(diff.status, 'cutoff');
  assert.deepEqual(diff.segments, []);
  assert.equal(diff.saved, saved);
  assert.equal(diff.current, current);
});

test('25ms timeout deterministically cuts off and retains complete originals', t => {
  let calls = 0;
  t.mock.method(Date, 'now', () => calls++ === 0 ? 0 : 26);
  const saved = 'start old end';
  const current = 'start new end';
  const diff = requestTextDiff(saved, current);
  assert.equal(diff.status, 'cutoff');
  assert.deepEqual(diff.segments, []);
  assert.equal(diff.saved, saved);
  assert.equal(diff.current, current);
});
