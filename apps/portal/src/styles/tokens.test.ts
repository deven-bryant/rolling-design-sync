import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

type Mode = 'light' | 'dark';

/** The design file's semantic colors: `[light, dark]`. */
const designColors: Record<string, [string, string]> = {
  'bg-primary': ['#ffffff', '#202527'],
  'bg-primary_alt': ['#ffffff', '#2b3033'],
  'bg-primary_hover': ['#f7fbfc', '#3c4245'],
  'bg-secondary': ['#f7fbfc', '#2b3033'],
  'bg-tertiary': ['#f2f6f7', '#3c4245'],
  'bg-quaternary': ['#e7eaec', '#575f63'],
  'bg-active': ['#f7fbfc', '#2b3033'],
  'bg-overlay': ['#0a0d0f', '#2b3033'],
  'bg-brand-solid': ['#1f6e84', '#1f6e84'],
  'bg-brand-solid_hover': ['#145d6e', '#4c8ba2'],
  'text-primary': ['#191e20', '#f4f8f9'],
  'text-secondary': ['#41474b', '#ccd0d3'],
  'text-secondary_hover': ['#272c2e', '#e9edef'],
  'text-tertiary': ['#52595d', '#91989b'],
  'text-quaternary': ['#70777b', '#91989b'],
  'text-placeholder': ['#70777b', '#82898d'],
  'text-white': ['#ffffff', '#ffffff'],
  'text-brand-secondary': ['#145d6e', '#ccd0d3'],
  'text-brand-tertiary': ['#1f6e84', '#91989b'],
  'fg-primary': ['#191e20', '#ffffff'],
  'fg-secondary': ['#41474b', '#ccd0d3'],
  'fg-tertiary': ['#52595d', '#91989b'],
  'fg-quaternary': ['#a2a8ab', '#575f63'],
  'fg-white': ['#ffffff', '#ffffff'],
  'fg-disabled': ['#a2a8ab', '#82898d'],
  'fg-disabled_subtle': ['#d3d8da', '#575f63'],
  'fg-brand-primary': ['#1f6e84', '#4c8ba2'],
  'fg-brand-primary_alt': ['#1f6e84', '#ccd0d3'],
  'fg-success-secondary': ['#17b26a', '#47cd89'],
  'border-primary': ['#d3d8da', '#3c4245'],
  'border-secondary': ['#e7eaec', '#2b3033'],
  'border-secondary_alt': ['#00000014', '#2b3033'],
  'border-disabled_subtle': ['#e7eaec', '#2b3033'],
  'button-primary-icon': ['#a7c5d4', '#a7c5d4'],
  'utility-gray-50': ['#f7fbfc', '#202527'],
  'utility-gray-200': ['#e7eaec', '#3c4245'],
  'utility-gray-700': ['#41474b', '#ccd0d3'],
  'utility-brand-50': ['#f2f6f9', '#042830'],
  'utility-brand-200': ['#ccdde7', '#0e4b59'],
  'utility-brand-700': ['#145d6e', '#a7c5d4'],
  'utility-success-50': ['#ecfdf3', '#053321'],
  'utility-success-200': ['#abefc6', '#085d3a'],
  'utility-success-500': ['#17b26a', '#17b26a'],
  'utility-success-700': ['#067647', '#75e0a7'],
  'utility-warning-50': ['#fffaeb', '#4e1d09'],
  'utility-warning-200': ['#fedf89', '#93370d'],
  'utility-warning-700': ['#b54708', '#fec84b'],
  'utility-error-50': ['#fef3f2', '#55160c'],
  'utility-error-200': ['#fecdca', '#912018'],
  'utility-error-700': ['#b42318', '#fda29b'],
  'utility-blue-50': ['#eff8ff', '#102a56'],
  'utility-blue-200': ['#b2ddff', '#1849a9'],
  'utility-blue-700': ['#175cd3', '#84caff'],
  'utility-blue-light-50': ['#f0f9ff', '#062c41'],
  'utility-blue-light-200': ['#b9e6fe', '#065986'],
  'utility-blue-light-700': ['#026aa2', '#7cd4fd'],
  'utility-indigo-50': ['#eef4ff', '#1f235b'],
  'utility-indigo-200': ['#c7d7fe', '#2d31a6'],
  'utility-indigo-700': ['#3538cd', '#a4bcfd'],
};

/** `--shadow-xs`'s drop color (5% alpha) and the skeumorphic ring color (18% alpha) per mode. */
const shadowColors: Record<Mode, { drop: string; skeumorphic: string }> = {
  light: { drop: '#0a0d120d', skeumorphic: '#0a0d122e' },
  dark: { drop: '#ffffff00', skeumorphic: '#0c0e122e' },
};

const LIGHT_SELECTOR = ':root, [data-theme="light"]';
const DARK_SELECTOR = ':root[data-theme="dark"], [data-theme="dark"]';

type Decls = Map<string, string>;

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const source = stripComments(css);

function declarations(body: string): Decls {
  const out: Decls = new Map();
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(name!, value!.trim());
  return out;
}

/** The body of the first `{…}` block whose prelude (selector) matches. */
function block(prelude: (selector: string) => boolean): { selector: string; body: string } {
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.trim().replace(/\s+/g, ' ').replace(/^.*@layer base \{\s*/, '');
    if (prelude(selector)) return { selector, body: m[2]! };
  }
  throw new Error('block not found');
}

const theme = declarations(source.slice(source.indexOf('@theme {'), source.indexOf('@layer base')));
const light = block(s => s.includes('[data-theme="light"]'));
const dark = block(s => s.includes('[data-theme="dark"]'));
const modes: Record<Mode, Decls> = { light: declarations(light.body), dark: declarations(dark.body) };

function hex(value: string): string {
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (!rgb) return value;
  const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(n => Number(n).toString(16).padStart(2, '0'));
  const alpha = rgb[4] === undefined ? '' : Math.round(Number(rgb[4]) * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}${alpha === 'ff' ? '' : alpha}`;
}

/**
 * Computes custom properties the way the cascade does: an element's own declarations resolve
 * against its own computed values, and everything else is inherited already resolved.
 */
function compute(own: Decls, inherited: Map<string, string>): Map<string, string> {
  const out = new Map(inherited);
  const resolve = (name: string, seen: Set<string>): string => {
    const value = own.get(name);
    if (value === undefined) return inherited.get(name) ?? `<unset ${name}>`;
    if (seen.has(name)) throw new Error(`cycle at ${name}`);
    return value.replace(/var\((--[\w-]+)\)/g, (_, ref: string) => resolve(ref, new Set(seen).add(name)));
  };
  for (const name of own.keys()) out.set(name, resolve(name, new Set()));
  return out;
}

/** `<html>` in a mode: the `@theme` defaults, then that mode's block. */
const rootIn = (mode: Mode) => compute(new Map([...theme, ...modes[mode]]), new Map());
/** An element inside a nested `data-theme` scope of the other mode. */
const nestedIn = (mode: Mode) => compute(modes[mode], rootIn(mode === 'dark' ? 'light' : 'dark'));

const color = (computed: Map<string, string>, token: string) => hex(computed.get(`--color-${token}`) ?? `<missing ${token}>`);

describe('tokens.css', () => {
  it('declares the light values on :root and [data-theme=light], the dark values on [data-theme=dark]', () => {
    expect(light.selector).toBe(LIGHT_SELECTOR);
    expect(dark.selector).toBe(DARK_SELECTOR);
    expect(light.body).toMatch(/color-scheme:\s*light;/);
    expect(dark.body).toMatch(/color-scheme:\s*dark;/);
  });

  it('re-declares the same variables in both modes, covering every @theme variable that references another', () => {
    expect([...modes.dark.keys()].sort()).toEqual([...modes.light.keys()].sort());
    // Anything built on a mode variable must be re-declared too, or <html>'s resolved value is inherited.
    const dependent = new Set(modes.light.keys());
    for (let grew = true; grew; ) {
      grew = false;
      for (const [name, value] of theme) {
        const refs = [...value.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]!);
        if (!dependent.has(name) && refs.some(ref => dependent.has(ref))) grew = Boolean(dependent.add(name));
      }
    }
    expect([...dependent].filter(name => !modes.light.has(name))).toEqual([]);
  });

  it('keeps the @theme defaults equal to the light mode', () => {
    for (const [name, value] of modes.light) if (theme.has(name)) expect([name, theme.get(name)]).toEqual([name, value]);
  });

  describe.each([
    ['light', 0],
    ['dark', 1],
  ] as const)('%s mode', (mode, column) => {
    it.each(Object.entries(designColors))('%s resolves to the design value', (token, values) => {
      expect(color(rootIn(mode), token)).toBe(values[column]);
    });

    it.each(Object.entries(designColors))('%s resolves to the design value in a nested scope', (token, values) => {
      expect(color(nestedIn(mode), token)).toBe(values[column]);
    });

    it('themes the shadow colors, nested scopes included', () => {
      for (const computed of [rootIn(mode), nestedIn(mode)]) {
        expect(computed.get('--shadow-xs')).toBe(`0px 1px 2px ${computed.get('--theme-shadow-5')}`);
        expect(hex(computed.get('--theme-shadow-5') ?? '')).toBe(shadowColors[mode].drop);
        expect(hex(computed.get('--theme-skeumorphic-18') ?? '')).toBe(shadowColors[mode].skeumorphic);
        expect(computed.get('--shadow-xs-skeumorphic')).toContain(computed.get('--theme-skeumorphic-18'));
      }
    });
  });
});
