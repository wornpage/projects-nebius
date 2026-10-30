const palettes = ['neutral', 'original'];
const modes = ['system', 'light', 'dark'];

/** @param {string} choice */
export function splitThemeChoice(choice) {
  const [palette, mode, extra] = String(choice).split('-');
  if (!palettes.includes(palette) || !modes.includes(mode) || extra !== undefined) {
    throw new TypeError('Unknown theme choice.');
  }
  return { palette, mode };
}

/** @param {string} choice @param {'palette' | 'mode'} part @param {string} value */
export function replaceThemePart(choice, part, value) {
  const current = splitThemeChoice(choice);
  if (part !== 'palette' && part !== 'mode') throw new TypeError('Unknown theme part.');
  const next = { ...current, [part]: value };
  const result = `${next.palette}-${next.mode}`;
  splitThemeChoice(result);
  return result;
}

/**
 * @param {{right: number, top: number, bottom: number}} anchor
 * @param {{width: number, height: number}} panel
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 */
export function appearancePosition(anchor, panel, viewportWidth, viewportHeight) {
  const gap = 8;
  const edge = 16;
  const left = Math.max(edge, Math.min(anchor.right - panel.width, viewportWidth - panel.width - edge));
  const below = anchor.bottom + gap;
  const top = below + panel.height <= viewportHeight - edge ? below : Math.max(edge, anchor.top - panel.height - gap);
  return { left, top };
}
