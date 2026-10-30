import test from 'node:test';
import assert from 'node:assert/strict';
import { shellNavigation, taskNavigationHref, isPlainNavigationClick } from '../svelte-frontend/src/lib/nebius-shell-navigation.mjs';

test('Work and Task are the only destinations without an explicit selection', () => {
  assert.deepEqual(shellNavigation().map(({ label, href }) => [label, href]), [['Work', '/work'], ['Task', '/next']]);
  for (const taskHref of ['/next?pack=', '/next?pack=one&pack=two', '/next?view=tool']) {
    assert.equal(shellNavigation({ taskHref }).length, 2);
  }
});

test('an exact selected task gets Brief, Tool, Review with escaped pack scope', () => {
  const links = shellNavigation({ taskHref: '/next?pack=a%26b%20%2F%3F&view=tool', pathname: '/next' });
  assert.deepEqual(links.filter((item) => item.detail).map(({ href }) => href), [
    '/next?pack=a%26b%20%2F%3F&view=brief', '/next?pack=a%26b%20%2F%3F&view=tool', '/next?pack=a%26b%20%2F%3F&view=review'
  ]);
  assert.deepEqual(links.filter((item) => item.current).map(({ label }) => label), ['Task', 'Tool']);
});

test('live view overrides the link view and current cues are absent on other pages', () => {
  const options = { taskHref: '/next?pack=chosen&view=tool', pathname: '/next', currentView: 'review' };
  assert.deepEqual(shellNavigation(options).filter((item) => item.detail && item.current).map(({ label }) => label), ['Review']);
  assert.deepEqual(shellNavigation({ ...options, pathname: '/work' }).filter((item) => item.current).map(({ label }) => label), ['Work']);
  assert.equal(shellNavigation({ taskHref: '/next?pack=chosen&view=tool&view=review', pathname: '/next' }).find((item) => item.detail && item.current).label, 'Brief');
});

test('untrusted and noncanonical Task destinations cannot create external links', () => {
  for (const input of ['https://other.invalid/next?pack=x', '//other.invalid/next?pack=x', '/next-other?pack=x', '/next/../work?pack=x', '/next\\evil?pack=x', 'javascript:alert(1)', null]) {
    assert.equal(taskNavigationHref(input), '/next');
    assert.equal(shellNavigation({ taskHref: input }).length, 2);
  }
  assert.equal(taskNavigationHref('/next?pack=valid#task'), '/next?pack=valid#task');
});

test('only unmodified primary activation participates in destination focus handling', () => {
  const click = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  assert.equal(isPlainNavigationClick(click), true);
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey', 'defaultPrevented']) assert.equal(isPlainNavigationClick({ ...click, [modifier]: true }), false);
  for (const button of [1, 2]) assert.equal(isPlainNavigationClick({ ...click, button }), false);
});
