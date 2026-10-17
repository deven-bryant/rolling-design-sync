'use strict';

/*
 * Render-check comparison (docs/api-v3-design.md, "Screens and render
 * checks"), plain JS on raw RGBA pixels. Images are never resized: where one
 * image is larger, the pixels outside the other count as different. Masked
 * rectangles are skipped. A pixel differs when its YIQ color distance is over
 * `tolerance` (0–1), which absorbs antialiasing and compression noise.
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

/**
 * Compares `built` with `reference`.
 * @param {{ data: Uint8Array, width: number, height: number }} reference
 * @param {{ data: Uint8Array, width: number, height: number }} built
 * @param {{ masks?: { x: number, y: number, width: number, height: number }[], tolerance?: number }} [options]
 * @returns {{ width: number, height: number, score: number, different: number, compared: number, sizeMatch: boolean,
 *   regions: { x: number, y: number, width: number, height: number, pixels: number }[], intensity: Uint8Array }}
 *   `score`: % of the compared (unmasked) pixels that differ; `intensity`: 0–255 per pixel (0 = same).
 */
function compareImages(reference, built, { masks = [], tolerance = 0.1 } = {}) {
  const width = Math.max(reference.width, built.width);
  const height = Math.max(reference.height, built.height);
  const intensity = new Uint8Array(width * height);
  const masked = new Uint8Array(width * height);
  for (const m of masks) {
    for (let y = Math.max(0, m.y); y < Math.min(height, m.y + m.height); y++) {
      masked.fill(1, y * width + Math.max(0, m.x), y * width + Math.min(width, m.x + m.width));
    }
  }
  const limit = MAX_DELTA * tolerance * tolerance;
  let different = 0;
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
        if (delta > limit) level = Math.max(1, Math.min(255, Math.round(255 * Math.sqrt(delta / MAX_DELTA))));
      }
      if (level) { intensity[p] = level; different++; }
    }
  }
  const score = compared ? Math.round((different / compared) * 100 * 1000) / 1000 : 0;
  return {
    width, height, score, different, compared, sizeMatch: reference.width === built.width && reference.height === built.height,
    regions: regionsOf(intensity, width, height), intensity,
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

/**
 * The heatmap: the built image in grayscale, with the differing pixels
 * colored cold → hot by how much they differ, at 60% opacity.
 * @param {{ data: Uint8Array, width: number, height: number }} built
 * @param {{ width: number, height: number, intensity: Uint8Array }} diff
 */
function heatmap(built, diff, { opacity = 0.6 } = {}) {
  const { width, height, intensity } = diff;
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
      }
      data[p * 4] = Math.round(rgb[0]); data[p * 4 + 1] = Math.round(rgb[1]); data[p * 4 + 2] = Math.round(rgb[2]); data[p * 4 + 3] = 255;
    }
  }
  return { data, width, height };
}

module.exports = { compareImages, heatmap, heatColor, colorDelta, MAX_REGIONS };
