import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { setImmediate as settle } from 'node:timers/promises';
import { shellNavigation, isPlainNavigationClick } from '../svelte-frontend/src/lib/nebius-shell-navigation.mjs';
import { projectNavigation, filterCommandNavigation } from '../svelte-frontend/src/lib/nebius-command-navigation.mjs';

const require = createRequire(new URL('../svelte-frontend/package.json', import.meta.url));
const { compile } = require('svelte/compiler');
const ts = require('typescript');
const filename = new URL('../svelte-frontend/src/lib/components/NebiusNavigate.svelte', import.meta.url);
const source = readFileSync(filename, 'utf8');
const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

/** Run the component's actual TS functions with bounded DOM/rune doubles. This
 * verifies lifecycle ordering without pretending to be rendered browser QA. */
function surface(props = {}) {
  const frames = [], log = [], effects = [];
  let before, after;
  const doc = { activeElement: null, querySelector: (selector) => ['dialog:modal', '[aria-modal="true"], dialog[open]'].includes(selector) ? (dialog.open ? dialog : null) : main,
    querySelectorAll: () => [primary] };
  class Element {
    constructor(name) { this.name = name; this.isConnected = true; this.shown = true; this.tabIndex = 0; }
    getClientRects() { return this.shown ? [{}] : []; }
    closest() { return null; }
    matches() { return Boolean(this.disabled); }
    focus() { doc.activeElement = this; log.push(`focus:${this.name}`); }
    hasAttribute() { return true; }
    setAttribute() {}
    getAttribute() { return this === primary ? 'page' : null; }
    click() { log.push(`click:${this.name}`); }
    scrollIntoView() {}
  }
  const trigger = new Element('navigate'), work = new Element('work-commands'), input = new Element('search'),
    close = new Element('close'), primary = new Element('primary'), main = new Element('main'), chosen = new Element('selected');
  const dialog = { open: false, returnValue: '', showModal() { this.open = true; log.push('show'); },
    close(value = '') { this.open = false; this.returnValue = value; log.push(`close:${value}`); },
    querySelector: () => chosen, querySelectorAll: () => [close, input, chosen], contains: (item) => [close, input, chosen].includes(item) };
  doc.activeElement = work;
  const $props = () => props;
  $props.id = () => 'test-commands';
  const $derived = (value) => value;
  $derived.by = (fn) => fn();
  const context = vm.createContext({ console, document: doc, HTMLElement: Element, getComputedStyle: () => ({ visibility: 'visible' }),
    $props, $derived, $state: (value) => value, $effect: (fn) => effects.push(fn), onMount() {},
    tick: async () => { log.push('tick'); }, requestAnimationFrame: (fn) => { frames.push(fn); },
    beforeNavigate: (fn) => { before = fn; }, onNavigate: (fn) => { after = fn; },
    shellNavigation, isPlainNavigationClick, filterCommandNavigation });
  const code = scripts.join('\n').replace(/^\s*import .*;\s*$/gm, '').replace(/export function /g, 'function ') + `
    globalThis.harness = { open, dismiss, closed, observeLink, activateCommand, reconcileVisibility, handleKeys, nextCommandKey, matchesCommand,
      bind(t, d, s) { trigger=t; dialog=d; search=s; }, selection() { return selectedKey; }, options() { return options; }, total() { return totalOptions; },
      setTriggerVisible(value) { triggerVisible=value; }, setActive(value) { active=value; } };`;
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  context.harness.bind(trigger, dialog, input);
  return { ...context.harness, log, frames, doc, trigger, work, input, close, chosen, primary, dialog, effects,
    before: (event) => before(event), after: () => after(), flushFrames: () => { for (const fn of frames.splice(0)) fn(); } };
}

const model = () => projectNavigation({ projects: [{ id: 'p', title: 'Project <literal>' }], selectedProjectId: 'p', currentTaskId: 'second', pathname: '/work', packs: [
  { id: 'third', projectId: 'p', title: 'Zulu', status: 'done', archived: true },
  { id: 'second', projectId: 'p', title: 'Alpha <script>', status: 'active' },
  { id: 'first', projectId: 'p', title: 'Alpha older', status: 'planned' }
] });
const key = (name, target, extra = {}) => ({ key: name, target, defaultPrevented: false, prevented: false,
  preventDefault() { this.prevented = true; }, ...extra });

test('the real Svelte client and server compilers accept the shared Commands surface', () => {
  for (const generate of ['client', 'server']) {
    const result = compile(source, { filename: filename.pathname, generate });
    assert.ok(result.js.code.length > 0);
    assert.deepEqual(result.warnings.filter(({ code }) => code.startsWith('a11y')).map(({ code, message }) => ({ code, message })), []);
  }
});

test('markup exposes one dialog, a search combobox, literal links and independent current/selected cues', () => {
  assert.equal((source.match(/<dialog\b/g) ?? []).length, 1);
  assert.match(source, /<h2[^>]*>Commands<\/h2>/);
  assert.match(source, /role="combobox"[^>]*data-nebius-command-search[^>]*aria-label="Find tasks or commands"/);
  assert.match(source, /role="listbox"[^>]*aria-label="Tasks and commands"/);
  assert.match(source, /aria-activedescendant=/);
  assert.match(source, /<a[^>]*href=\{item.href\}[^>]*aria-selected=\{selectedKey === item.key\}[^>]*aria-current=\{item.current/);
  assert.match(source, /<small>Current task/);
  assert.match(source, /disabled=\{item.disabled\}/);
  assert.match(source, /aria-describedby=\{item.description/);
  assert.match(source, /\{options.length\} of \{totalOptions\}/);
  assert.match(source, /No tasks or commands match your search\./);
  assert.doesNotMatch(source, /\{@html|fetch\(|localStorage|goto\(|preventDefault\(\).*observeLink/);
  assert.match(source, /max-height: calc\(100dvh - 32px\)/);
  assert.match(source, /overflow-wrap: anywhere/);
  assert.match(source, /min-height: 44px/);
});

test('supplied task order, archived status, known task views and Work callback identities survive projection', () => {
  const commands = [{ id: 'edit', label: 'Edit task', description: 'Existing editor', run() {} },
    { id: 'remove', label: 'Remove task', description: 'Select a task first', disabled: true, run() { throw Error('disabled'); } }];
  const h = surface({ navigation: model(), commands, pathname: '/next' });
  assert.deepEqual(Array.from(h.options(), (item) => item.key), ['all-work', 'task:third', 'task:second', 'task:first', 'view:Brief', 'view:Tool', 'view:Review', 'command:edit', 'command:remove']);
  assert.equal(h.options()[1].archived, true);
  assert.equal(h.options()[1].status, 'done');
  assert.equal(h.options()[2].current, true);
  assert.equal(h.options()[2].label, 'Alpha <script>');
  assert.equal(h.options().at(-1).description, 'Select a task first');
  assert.equal(h.total(), 9);
  assert.equal(surface({ navigation: model(), pathname: '/work' }).options().some((item) => item.key.startsWith('view:')), false);
  assert.equal(surface({ taskHref: '/next?pack=unknown', navigation: { ...model(), tasks: [] } }).options().some((item) => item.key.startsWith('view:')), false);
});

test('literal search and keyboard movement retain ordering while skipping disabled commands', () => {
  const h = surface();
  const rows = [{ key: 'z' }, { key: 'disabled', disabled: true }, { key: 'a' }];
  assert.equal(h.nextCommandKey(rows, '', 'first'), 'z');
  assert.equal(h.nextCommandKey(rows, 'z', 'next'), 'a');
  assert.equal(h.nextCommandKey(rows, 'a', 'next'), 'z');
  assert.equal(h.nextCommandKey(rows, 'z', 'previous'), 'a');
  assert.equal(h.nextCommandKey(rows, 'z', 'last'), 'a');
  assert.equal(h.nextCommandKey([{ key: 'disabled', disabled: true }], '', 'first'), '');
  assert.equal(h.matchesCommand('Alpha <script>', ' <SCRIPT> '), true);
  assert.equal(h.matchesCommand('Alpha', '.*'), false);
  const filtered = filterCommandNavigation(model(), 'Alpha');
  assert.deepEqual(filtered.tasks.map(({ id }) => id), ['second', 'first']);
  assert.deepEqual([filtered.matched, filtered.total], [2, 3]);
});

test('Work opens the same dialog with hidden Navigate, focuses search and restores the actual visible opener', async () => {
  const h = surface({ triggerVisible: false });
  h.trigger.shown = false;
  h.open();
  await Promise.resolve();
  assert.equal(h.dialog.open, true);
  assert.equal(h.doc.activeElement, h.input);
  h.reconcileVisibility();
  assert.equal(h.dialog.open, true);
  h.dismiss(); h.closed();
  assert.equal(h.doc.activeElement, h.work);
  h.open(); h.work.shown = false; h.reconcileVisibility(); h.closed();
  assert.equal(h.dialog.open, false);
  assert.equal(h.doc.activeElement, h.primary);
});

test('a hidden compact opener dismisses safely and inactive instances cannot open', () => {
  const h = surface();
  h.doc.activeElement = h.trigger;
  h.open(); h.trigger.shown = false; h.setTriggerVisible(false); h.reconcileVisibility(); h.closed();
  assert.equal(h.dialog.open, false);
  assert.equal(h.doc.activeElement, h.primary);
  h.setActive(false); h.open();
  assert.equal(h.dialog.open, false);
});

test('dismissal before input focus settles cannot reopen focus or compete with another modal', async () => {
  const h = surface();
  h.open(); h.dismiss(); h.closed();
  await settle();
  assert.equal(h.doc.activeElement, h.work);
  const before = h.log.length;
  h.doc.querySelector = () => ({ open: true });
  h.open();
  assert.equal(h.log.length, before);
});

test('modified native links remain untouched; ordinary links and cancelled history release modal focus isolation', async () => {
  const h = surface(); h.open();
  await settle();
  const plain = { button: 0, currentTarget: { href: 'https://example.invalid/next?pack=x' }, defaultPrevented: false };
  for (const modification of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    h.observeLink({ ...plain, ...modification });
    assert.equal(h.dialog.open, true);
  }
  h.observeLink(plain); h.closed();
  assert.equal(h.dialog.returnValue, 'navigation');
  assert.notEqual(h.doc.activeElement, h.work);
  h.open(); h.before({ type: 'popstate' }); h.closed();
  assert.equal(h.dialog.open, false);
  assert.notEqual(h.doc.activeElement, h.work);
  assert.equal(h.frames.length, 0, 'beforeNavigate alone must not schedule post-navigation focus');
  const completed = h.after();
  assert.equal(typeof completed, 'function', 'only permitted navigation returns destination focus work');
});

test('command activation releases the modal, waits for a frame, runs the current handler and never restores opener focus', { timeout: 3000 }, async () => {
  const commands = [{ id: 'edit', label: 'Edit', description: 'Open editor', run() { throw Error('old callback'); } },
    { id: 'no', label: 'No', description: 'Unavailable', disabled: true, run() { throw Error('disabled'); } }];
  const h = surface({ commands }); h.open(); await Promise.resolve();
  await h.activateCommand('no');
  assert.equal(h.dialog.open, true);
  const pending = h.activateCommand('edit');
  h.closed();
  assert.equal(h.dialog.open, false);
  assert.equal(h.dialog.returnValue, 'command');
  assert.equal(h.log.includes('focus:work-commands'), false);
  commands[0].run = () => h.log.push('run:current');
  await settle();
  assert.equal(h.log.includes('run:current'), false);
  h.flushFrames(); await pending;
  assert.equal(h.log.at(-1), 'run:current');
  assert.ok(h.log.indexOf('close:command') < h.log.indexOf('run:current'));
});

test('arrows, Home/End, Enter and Tab use real handlers without hijacking modified keys', async () => {
  const h = surface({ commands: [{ id: 'disabled', label: 'Disabled', description: 'Unavailable', disabled: true, run() {} }, { id: 'last', label: 'Last', description: 'Run', run() {} }] });
  h.open(); await Promise.resolve();
  const end = key('End', h.input); h.handleKeys(end);
  assert.equal(end.prevented, true); assert.equal(h.selection(), 'command:last');
  h.handleKeys(key('ArrowUp', h.input)); assert.equal(h.selection(), 'all-work');
  const modified = key('ArrowDown', h.input, { ctrlKey: true }); h.handleKeys(modified);
  assert.equal(modified.prevented, false); assert.equal(h.selection(), 'all-work');
  h.handleKeys(key('Enter', h.input)); assert.ok(h.log.includes('click:selected'));
  h.doc.activeElement = h.chosen;
  const tab = key('Tab', h.chosen); h.handleKeys(tab);
  assert.equal(tab.prevented, true); assert.equal(h.doc.activeElement, h.close);
  const reverse = key('Tab', h.close, { shiftKey: true }); h.handleKeys(reverse);
  assert.equal(reverse.prevented, true); assert.equal(h.doc.activeElement, h.chosen);
});
