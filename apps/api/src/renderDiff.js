'use strict';

/*
 * Render-check comparison (docs/api-v3-design.md, "Screens and render
 * checks"), plain JS on raw RGBA pixels. Images are never resized: where one
 * image is larger, the pixels outside the other count as different. Masked
 * rectangles are skipped. A pixel differs when its YIQ color distance is over
 * `tolerance` (0–1), which absorbs compression noise. A differing pixel that
 * is an anti-aliased edge in either image (glyph and shape edges rasterized
 * differently by Figma and the browser) is not counted: it is reported in
 * `antialiased` and shown in a faint neutral colour on the heatmap.
 *
 * The anti-aliased pixel detector (`slopeAt`, `antialiased`, `hasManySiblings`) is ported
 * from pixelmatch (https://github.com/mapbox/pixelmatch), after V. Vyšniauskas,
 * "Anti-aliased pixel and intensity slope detector" (2009), extended with the
 * edge-in-both-images rule (`hasEdge`):
 *
 *   ISC License. Copyright (c) 2025, Mapbox
 *
 *   Permission to use, copy, modify, and/or distribute this software for any
 *   purpose with or without fee is hereby granted, provided that the above
 *   copyright notice and this permission notice appear in all copies.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 *   WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 *   MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 *   SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 *   WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 *   ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
 *   IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/** Max squared YIQ distance between two colors (pixelmatch's constant). */
const MAX_DELTA = 35215;
const MAX_REGIONS = 10;
/** Boxes closer than this many px are merged into one region. */
const MERGE_GAP = 8;

function blend(c, a) { return 255 + (c - 255) * a; }

/** Squared YIQ distance of two RGBA pixels (alpha-blended onto white). */
function colorDelta(a, i, b, j) {
  const aa = a[i + 3] / 255; const ab = b[j + 3] / 255;
  const r1 = blend(a[i], aa); const g1 = blend(a[i + 1], aa); const b1 = blend(a[i + 2], aa);
  const r2 = blend(b[j], ab); const g2 = blend(b[j + 1], ab); const b2 = blend(b[j + 2], ab);
  const dr = r1 - r2; const dg = g1 - g2; const db = b1 - b2;
  const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
  const iq = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
  const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;
  return 0.5053 * y * y + 0.299 * iq * iq + 0.1957 * q * q;
}

/** Signed brightness (YIQ Y) difference of two RGBA pixels, alpha-blended onto white. */
function brightnessDelta(a, i, b, j) {
  const aa = a[i + 3] / 255; const ab = b[j + 3] / 255;
  return (blend(a[i], aa) - blend(b[j], ab)) * 0.29889531
    + (blend(a[i + 1], aa) - blend(b[j + 1], ab)) * 0.58662247
    + (blend(a[i + 2], aa) - blend(b[j + 2], ab)) * 0.11448223;
}

/** Brightness range (YIQ Y) of a pixel's 3×3 neighbourhood over which it counts as an edge. */
const EDGE_CONTRAST = 16;

/**
 * The intensity slope at (x1, y1) of `img`: at most 2 of its 8 neighbours are
 * equal to it and it has both darker and lighter ones. Returns the darkest and
 * the brightest neighbour, or null. `w` × `h` is the area both images cover.
 * @param {{ data: Uint8Array, width: number }} img
 */
function slopeAt(img, x1, y1, w, h) {
  const x0 = Math.max(x1 - 1, 0); const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, w - 1); const y2 = Math.min(y1 + 1, h - 1);
  const pos = (y1 * img.width + x1) * 4;
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
  let min = 0; let max = 0;
  let minX = 0; let minY = 0; let maxX = 0; let maxY = 0;
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;
      const delta = brightnessDelta(img.data, pos, img.data, (y * img.width + x) * 4);
      if (delta === 0) {
        zeroes++;
        if (zeroes > 2) return null;
      } else if (delta < min) {
        min = delta; minX = x; minY = y;
      } else if (delta > max) {
        max = delta; maxX = x; maxY = y;
      }
    }
  }
  if (min === 0 || max === 0) return null;
  return { minX, minY, maxX, maxY };
}

/** Whether `img` has an edge at (x1, y1): its 3×3 neighbourhood spans more than EDGE_CONTRAST in brightness. */
function hasEdge(img, x1, y1, w, h) {
  const d = img.data;
  let lo = Infinity; let hi = -Infinity;
  for (let y = Math.max(y1 - 1, 0); y <= Math.min(y1 + 1, h - 1); y++) {
    for (let x = Math.max(x1 - 1, 0); x <= Math.min(x1 + 1, w - 1); x++) {
      const i = (y * img.width + x) * 4;
      const a = d[i + 3] / 255;
      const v = blend(d[i], a) * 0.29889531 + blend(d[i + 1], a) * 0.58662247 + blend(d[i + 2], a) * 0.11448223;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return hi - lo > EDGE_CONTRAST;
}

/**
 * Whether pixel (x1, y1) of `img` is anti-aliased: it sits on an intensity
 * slope (slopeAt) and either its darkest or brightest neighbour is in a flat
 * area (3+ equal neighbours) in both `img` and `other` (pixelmatch's rule), or
 * `other` has an edge at the same spot (the two renderers drew the same edge
 * differently). Content missing from `other` is flat there, so it still counts.
 * @param {{ data: Uint8Array, width: number }} img
 * @param {{ data: Uint8Array, width: number }} other
 */
function antialiased(img, other, x1, y1, w, h) {
  const s = slopeAt(img, x1, y1, w, h);
  if (!s) return false;
  return (hasManySiblings(img, s.minX, s.minY, w, h) && hasManySiblings(other, s.minX, s.minY, w, h))
    || (hasManySiblings(img, s.maxX, s.maxY, w, h) && hasManySiblings(other, s.maxX, s.maxY, w, h))
    || hasEdge(other, x1, y1, w, h);
}

/** Whether pixel (x1, y1) has 3+ neighbours of exactly its colour. */
function hasManySiblings(img, x1, y1, w, h) {
  const x0 = Math.max(x1 - 1, 0); const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, w - 1); const y2 = Math.min(y1 + 1, h - 1);
  const d = img.data;
  const pos = (y1 * img.width + x1) * 4;
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;
      const q = (y * img.width + x) * 4;
      if (d[pos] === d[q] && d[pos + 1] === d[q + 1] && d[pos + 2] === d[q + 2] && d[pos + 3] === d[q + 3]) zeroes++;
      if (zeroes > 2) return true;
    }
  }
  return false;
}

/**
 * Compares `built` with `reference`.
 * @param {{ data: Uint8Array, width: number, height: number }} reference
 * @param {{ data: Uint8Array, width: number, height: number }} built
 * @param {{ masks?: { x: number, y: number, width: number, height: number }[], tolerance?: number }} [options]
 * @returns {{ width: number, height: number, score: number, different: number, antialiased: number, compared: number, sizeMatch: boolean,
 *   regions: { x: number, y: number, width: number, height: number, pixels: number }[], intensity: Uint8Array, aa: Uint8Array }}
 *   `score`: % of the compared (unmasked) pixels that differ, anti-aliased ones not counted; `antialiased`: differing
 *   pixels ignored as anti-aliasing; `intensity`: 0–255 per counted pixel (0 = same); `aa`: 1 per ignored pixel.
 */
function compareImages(reference, built, { masks = [], tolerance = 0.1 } = {}) {
  const width = Math.max(reference.width, built.width);
  const height = Math.max(reference.height, built.height);
  const intensity = new Uint8Array(width * height);
  const aa = new Uint8Array(width * height);
  const overlapW = Math.min(reference.width, built.width);
  const overlapH = Math.min(reference.height, built.height);
  const masked = new Uint8Array(width * height);
  for (const m of masks) {
    for (let y = Math.max(0, m.y); y < Math.min(height, m.y + m.height); y++) {
      masked.fill(1, y * width + Math.max(0, m.x), y * width + Math.min(width, m.x + m.width));
    }
  }
  const limit = MAX_DELTA * tolerance * tolerance;
  let different = 0;
  let antialiasedCount = 0;
  let compared = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (masked[p]) continue;
      compared++;
      const inRef = x < reference.width && y < reference.height;
      const inBuilt = x < built.width && y < built.height;
      let level = 0;
      if (!inRef || !inBuilt) level = 255;
      else {
        const delta = colorDelta(reference.data, (y * reference.width + x) * 4, built.data, (y * built.width + x) * 4);
        if (delta > limit) {
          if (antialiased(reference, built, x, y, overlapW, overlapH) || antialiased(built, reference, x, y, overlapW, overlapH)) {
            aa[p] = 1;
            antialiasedCount++;
            continue;
          }
          level = Math.max(1, Math.min(255, Math.round(255 * Math.sqrt(delta / MAX_DELTA))));
        }
      }
      if (level) { intensity[p] = level; different++; }
    }
  }
  const score = compared ? Math.round((different / compared) * 100 * 1000) / 1000 : 0;
  return {
    width, height, score, different, antialiased: antialiasedCount, compared,
    sizeMatch: reference.width === built.width && reference.height === built.height,
    regions: regionsOf(intensity, width, height), intensity, aa,
  };
}

/** Bounding boxes of the 8-connected differing areas, merged when close, largest first (at most 10). */
function regionsOf(intensity, width, height) {
  const seen = new Uint8Array(width * height);
  let boxes = [];
  const stack = [];
  for (let start = 0; start < intensity.length; start++) {
    if (!intensity[start] || seen[start]) continue;
    let x0 = width; let y0 = height; let x1 = -1; let y1 = -1; let pixels = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = /** @type {number} */ (stack.pop());
      const x = p % width; const y = (p - x) / width;
      pixels++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (intensity[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }
    boxes.push({ x0, y0, x1, y1, pixels });
  }
  boxes = mergeBoxes(boxes);
  return boxes
    .map(b => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0 + 1, height: b.y1 - b.y0 + 1, pixels: b.pixels }))
    .sort((a, b) => b.width * b.height - a.width * a.height || a.y - b.y || a.x - b.x)
    .slice(0, MAX_REGIONS);
}

function mergeBoxes(boxes) {
  const near = (a, b) => a.x0 <= b.x1 + MERGE_GAP && b.x0 <= a.x1 + MERGE_GAP && a.y0 <= b.y1 + MERGE_GAP && b.y0 <= a.y1 + MERGE_GAP;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (!near(boxes[i], boxes[j])) continue;
        const a = boxes[i]; const b = boxes[j];
        boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), pixels: a.pixels + b.pixels };
        boxes.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return boxes;
}

/** Cold (blue) → hot (red) color of a 1–255 difference level. */
function heatColor(level) {
  const t = level / 255;
  /** @type {[number, number[]][]} */
  const stops = [[0, [0, 64, 255]], [0.33, [0, 220, 255]], [0.66, [255, 220, 0]], [1, [255, 0, 0]]];
  for (let k = 1; k < stops.length; k++) {
    const [t1, c1] = stops[k];
    const [t0, c0] = stops[k - 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return c0.map((v, n) => Math.round(v + (c1[n] - v) * f));
    }
  }
  return [255, 0, 0];
}

/** Faint neutral colour of the pixels ignored as anti-aliasing on the heatmap. */
const AA_COLOR = [150, 150, 170];
const AA_OPACITY = 0.35;

/**
 * The heatmap: the built image in grayscale, with the differing pixels
 * colored cold → hot by how much they differ, at 60% opacity, and the pixels
 * ignored as anti-aliasing in a faint neutral colour.
 * @param {{ data: Uint8Array, width: number, height: number }} built
 * @param {{ width: number, height: number, intensity: Uint8Array, aa?: Uint8Array }} diff
 */
function heatmap(built, diff, { opacity = 0.6 } = {}) {
  const { width, height, intensity, aa } = diff;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      let gray = 255;
      if (x < built.width && y < built.height) {
        const i = (y * built.width + x) * 4;
        const a = built.data[i + 3] / 255;
        gray = blend(0.299 * built.data[i] + 0.587 * built.data[i + 1] + 0.114 * built.data[i + 2], a);
      }
      let rgb = [gray, gray, gray];
      if (intensity[p]) {
        const hot = heatColor(intensity[p]);
        rgb = rgb.map((v, n) => v * (1 - opacity) + hot[n] * opacity);
      } else if (aa && aa[p]) {
        rgb = rgb.map((v, n) => v * (1 - AA_OPACITY) + AA_COLOR[n] * AA_OPACITY);
      }
      data[p * 4] = Math.round(rgb[0]); data[p * 4 + 1] = Math.round(rgb[1]); data[p * 4 + 2] = Math.round(rgb[2]); data[p * 4 + 3] = 255;
    }
  }
  return { data, width, height };
}

module.exports = { compareImages, heatmap, heatColor, colorDelta, antialiased, MAX_REGIONS, AA_COLOR };
