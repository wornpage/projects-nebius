import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitThemeChoice, replaceThemePart, appearancePosition } from '../svelte-frontend/src/lib/nebius-theme-choice.mjs';

test('every existing theme survives changing either independent radio group', () => {
  for (const palette of ['neutral', 'original']) {
    for (const mode of ['system', 'light', 'dark']) {
      const choice = `${palette}-${mode}`;
      assert.deepEqual(splitThemeChoice(choice), { palette, mode });
      for (const next of ['neutral', 'original']) assert.equal(replaceThemePart(choice, 'palette', next), `${next}-${mode}`);
      for (const next of ['system', 'light', 'dark']) assert.equal(replaceThemePart(choice, 'mode', next), `${palette}-${next}`);
    }
  }
});

test('malformed choices and radio values fail loudly instead of inventing a default', () => {
  for (const value of ['', 'dark', 'neutral-blue', 'green-dark', 'neutral-dark-extra', null]) assert.throws(() => splitThemeChoice(value), TypeError);
  assert.throws(() => replaceThemePart('neutral-system', 'mode', 'blue'), TypeError);
  assert.throws(() => replaceThemePart('neutral-system', 'other', 'dark'), TypeError);
});

test('popover anchors right, clamps to narrow viewport, and moves above near bottom', () => {
  assert.deepEqual(appearancePosition({ right: 1200, top: 60, bottom: 104 }, { width: 320, height: 400 }, 1280, 900), { left: 880, top: 112 });
  assert.deepEqual(appearancePosition({ right: 370, top: 60, bottom: 104 }, { width: 320, height: 400 }, 375, 812), { left: 39, top: 112 });
  assert.deepEqual(appearancePosition({ right: 100, top: 700, bottom: 744 }, { width: 320, height: 400 }, 375, 812), { left: 16, top: 292 });
  assert.deepEqual(appearancePosition({ right: 370, top: 20, bottom: 64 }, { width: 343, height: 700 }, 375, 500), { left: 16, top: 16 });
});

test('component uses native nonmodal popover and native radios with preserved theme authority', () => {
  const source = readFileSync(new URL('../svelte-frontend/src/lib/components/ThemePicker.svelte', import.meta.url), 'utf8');
  assert.match(source, /popover="auto"/);
  assert.match(source, /popovertarget="appearance-options"/);
  assert.doesNotMatch(source, /<select\b|<[^>]*\brole="dialog"|preventDefault|keydown|localStorage/);
  assert.match(source, /<legend>Palette<\/legend>/);
  assert.match(source, /<legend>Mode<\/legend>/);
  assert.match(source, /name="appearance-palette"/);
  assert.match(source, /name="appearance-mode"/);
  assert.match(source, /WornpageTheme/);
  assert.match(source, /wornpage:themechange/);
  assert.match(source, /api\.setChoice\(replaceThemePart\(api\.getChoice\(\)/);
  assert.match(source, /Theme changed for this tab; your browser could not save it\./);
  assert.match(source, /Theme controls are unavailable/);
});
