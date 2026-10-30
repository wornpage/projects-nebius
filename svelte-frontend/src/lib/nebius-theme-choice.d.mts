export type Palette = 'neutral' | 'original';
export type Mode = 'system' | 'light' | 'dark';
export function splitThemeChoice(choice: string): { palette: Palette; mode: Mode };
export function replaceThemePart(choice: string, part: 'palette' | 'mode', value: string): string;
export function appearancePosition(anchor: {right: number; top: number; bottom: number}, panel: {width: number; height: number}, viewportWidth: number, viewportHeight: number): {left: number; top: number};
