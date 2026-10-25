// Page pipeline: gray -> page quad -> dewarp -> background flatten -> ink field -> rule removal -> deskew.
// Pure typed-array code so it runs in the browser and in Node tests.
import { homography, applyH, warpWithH, sample, median } from "./geom.js";

export function rgbaToGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) / 255;
  return g;
}

function boxDown(src, w, h, f) {
  const ow = Math.max(1, Math.floor(w / f)), oh = Math.max(1, Math.floor(h / f));
  const out = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let s = 0, n = 0;
    for (let yy = y * f; yy < (y + 1) * f; yy++) for (let xx = x * f; xx < (x + 1) * f; xx++) { s += src[yy * w + xx]; n++; }
    out[y * ow + x] = s / n;
  }
  return { data: out, w: ow, h: oh };
}

function otsu(values, bins = 256, lo = 0, hi = 1) {
  const hist = new Float64Array(bins);
  for (let i = 0; i < values.length; i++) {
    let b = Math.floor(((values[i] - lo) / (hi - lo)) * bins);
    hist[b < 0 ? 0 : b >= bins ? bins - 1 : b]++;
  }
  const total = values.length;
  let sum = 0; for (let i = 0; i < bins; i++) sum += i * hist[i];
  let wB = 0, sB = 0, best = 0, bt = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; bt = i; }
  }
  return lo + ((bt + 0.5) / bins) * (hi - lo);
}

/** Find the paper as the biggest bright blob. Returns {quad:[TL,TR,BR,BL] in source px, ok, reason}. */
export function detectPageQuad(gray, w, h) {
  const f = Math.max(1, Math.round(Math.max(w, h) / 420));
  const s = boxDown(gray, w, h, f), sw = s.w, sh = s.h;
  // light blur
  const bl = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let a = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
      a += s.data[yy * sw + xx]; n++;
    }
    bl[y * sw + x] = a / n;
  }
  const t = otsu(bl);
  const mask = new Uint8Array(sw * sh);
  for (let i = 0; i < mask.length; i++) mask[i] = bl[i] > t ? 1 : 0;
  // largest 4-connected component
  const lab = new Int32Array(sw * sh); let best = 0, bestId = 0, id = 0;
  const stack = new Int32Array(sw * sh);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || lab[i]) continue;
    id++; let sp = 0, cnt = 0; stack[sp++] = i; lab[i] = id;
    while (sp) {
      const p = stack[--sp]; cnt++;
      const x = p % sw, y = (p / sw) | 0;
      if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < sw - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - sw] && !lab[p - sw]) { lab[p - sw] = id; stack[sp++] = p - sw; }
      if (y < sh - 1 && mask[p + sw] && !lab[p + sw]) { lab[p + sw] = id; stack[sp++] = p + sw; }
    }
    if (cnt > best) { best = cnt; bestId = id; }
  }
  const whole = [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]];
  if (best < 0.25 * sw * sh) return { quad: whole, ok: false, reason: "no bright page found" };
  // extreme points of that component
  let tl = null, tr = null, br = null, bl2 = null, vTL = 1e9, vTR = -1e9, vBR = -1e9, vBL = 1e9;
  let touchL = 0, touchR = 0, touchT = 0, touchB = 0;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (lab[y * sw + x] !== bestId) continue;
    if (x === 0) touchL++; if (x === sw - 1) touchR++; if (y === 0) touchT++; if (y === sh - 1) touchB++;
    const a = x + y, b = x - y;
    if (a < vTL) { vTL = a; tl = [x, y]; } if (a > vBR) { vBR = a; br = [x, y]; }
    if (b > vTR) { vTR = b; tr = [x, y]; } if (b < vBL) { vBL = b; bl2 = [x, y]; }
  }
  const quad = [tl, tr, br, bl2].map(([x, y]) => [(x + 0.5) * f, (y + 0.5) * f]);
  const area = Math.abs(quad.reduce((a, p, i) => { const q = quad[(i + 1) % 4]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const frac = area / (w * h);
  const cropped = Math.max(touchL / sh, touchR / sh, touchT / sw, touchB / sw) > 0.12;
  const fill = best * f * f / area;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const top = d(quad[0], quad[1]), bot = d(quad[3], quad[2]), lef = d(quad[0], quad[3]), rig = d(quad[1], quad[2]);
  const ratioOK = top / bot > 0.6 && top / bot < 1.65 && lef / rig > 0.6 && lef / rig < 1.65;
  if (cropped) return { quad: whole, ok: false, reason: "page runs off the photo edge", rawQuad: quad };
  if (frac < 0.3 || fill < 0.8 || !ratioOK) return { quad: whole, ok: false, reason: "page outline unclear", rawQuad: quad };
  return { quad, ok: true, frac };
}

/** Dewarp a quad [TL,TR,BR,BL] into an upright rectangle. Returns {data,w,h,Hback} where Hback maps output->source. */
export function dewarp(gray, w, h, quad, maxLong = 3000) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let ow = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2, oh = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2;
  const k = Math.min(1, maxLong / Math.max(ow, oh));
  ow = Math.round(ow * k); oh = Math.round(oh * k);
  const Hb = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], quad);
  return { data: warpWithH(gray, w, h, Hb, ow, oh), w: ow, h: oh, Hback: Hb };
}

/** Divide by a heavily smoothed paper estimate so shadows and gradients vanish (paper -> 1). */
export function flattenBackground(g, w, h) {
  const f = Math.max(4, Math.round(Math.max(w, h) / 220));
  const bw = Math.ceil(w / f), bh = Math.ceil(h / f);
  const blk = new Float32Array(bw * bh);
  const tmp = [];
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    tmp.length = 0;
    for (let y = by * f; y < Math.min(h, (by + 1) * f); y += 2) for (let x = bx * f; x < Math.min(w, (bx + 1) * f); x += 2) tmp.push(g[y * w + x]);
    tmp.sort((a, b) => a - b);
    // paper level: upper quartile of the block (ink is dark and sparse)
    blk[by * bw + bx] = tmp[Math.floor(tmp.length * 0.8)] || 1;
  }
  const R = Math.max(3, Math.round(0.035 * Math.max(w, h) / f));
  let cur = blk, t1 = new Float32Array(bw * bh);
  // separable max filter
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let m = 0; for (let k = -R; k <= R; k++) { const xx = x + k; if (xx >= 0 && xx < bw) m = Math.max(m, cur[y * bw + xx]); } t1[y * bw + x] = m; }
  const t2 = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let m = 0; for (let k = -R; k <= R; k++) { const yy = y + k; if (yy >= 0 && yy < bh) m = Math.max(m, t1[yy * bw + x]); } t2[y * bw + x] = m; }
  // smooth with box blur twice
  const bx = (src, r) => { const o = new Float32Array(src.length); for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < bw) { s += src[y * bw + xx]; n++; } } o[y * bw + x] = s / n; } return o; };
  const by = (src, r) => { const o = new Float32Array(src.length); for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < bh) { s += src[yy * bw + x]; n++; } } o[y * bw + x] = s / n; } return o; };
  let sm = by(bx(t2, Math.max(1, R >> 1)), Math.max(1, R >> 1)); sm = by(bx(sm, Math.max(1, R >> 2)), Math.max(1, R >> 2));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / f - 0.5));
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const bgv = Math.max(0.05, sample(sm, bw, bh, fx, fy));
      const v = g[y * w + x] / bgv;
      out[y * w + x] = v > 1.2 ? 1.2 : v;
    }
  }
  return out;
}

/** Convert flattened gray to a soft ink field d in [0,1] (1 = full ink, 0.5 = stroke edge). */
export function inkField(norm, w, h) {
  const n = norm.length;
  const clipped = new Float32Array(n);
  for (let i = 0; i < n; i++) clipped[i] = Math.min(1, norm[i]);
  const t = otsu(clipped, 256, 0, 1);
  let s = 0, c = 0;
  for (let i = 0; i < n; i++) if (clipped[i] < t) { s += clipped[i]; c++; }
  const inkFrac = c / n;
  // typical ink level: mean of the darker half of the dark pixels
  const dark = []; for (let i = 0; i < n; i += 3) if (clipped[i] < t) dark.push(clipped[i]);
  dark.sort((a, b) => a - b);
  const inkLevel = dark.length ? dark[Math.floor(dark.length * 0.35)] : 0.3;
  const range = Math.max(0.05, 1 - inkLevel);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = (1 - clipped[i]) / range; d[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
  return { d, inkLevel, otsu: t, inkFrac, contrast: range };
}

/** Remove long thin horizontal strokes (ruled lines), keep pixels where a pen stroke crosses them. */
export function removeRules(d, w, h) {
  // Ruled lines (possibly slightly tilted): pixels that sit in a long horizontal run and whose vertical
  // run is thin are removed; where a stroke crosses (long vertical run) the pixels are kept.
  const thr = 0.4, minRun = Math.max(40, Math.round(0.06 * w)), maxThick = Math.max(9, Math.round(0.005 * Math.max(w, h)));
  const hr = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && d[y * w + x] > thr) run++; else {
        if (run >= minRun) for (let k = x - run; k < x; k++) hr[y * w + k] = 1;
        run = 0;
      }
    }
  }
  let removed = 0;
  const kill = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      if (y < h && d[y * w + x] > thr) run++; else {
        if (run > 0 && run <= maxThick) for (let k = y - run; k < y; k++) if (hr[k * w + x]) kill[k * w + x] = 1;
        run = 0;
      }
    }
  }
  for (let i = 0; i < w * h; i++) if (kill[i]) { d[i] = 0; removed++; }
  return { removed };
}

/** Estimate skew angle (radians) from the ink points: maximise row-profile sharpness. */
export function estimateSkew(d, w, h) {
  const pts = [];
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 60000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (d[y * w + x] > 0.5) pts.push(x, y);
  if (pts.length < 200) return 0;
  const bin = Math.max(2, Math.round(w / 500)) * step / step;
  function score(a) {
    const s = Math.sin(a), c = Math.cos(a);
    const hist = new Map();
    for (let i = 0; i < pts.length; i += 2) {
      const yy = Math.floor((-pts[i] * s + pts[i + 1] * c) / (bin * 1.5));
      hist.set(yy, (hist.get(yy) || 0) + 1);
    }
    let sc = 0; for (const v of hist.values()) sc += v * v; return sc;
  }
  let best = 0, bs = -1;
  for (let deg = -12; deg <= 12.001; deg += 0.5) { const a = deg * Math.PI / 180, v = score(a); if (v > bs) { bs = v; best = a; } }
  const c0 = best;
  for (let deg = -0.6; deg <= 0.601; deg += 0.1) { const a = c0 + deg * Math.PI / 180, v = score(a); if (v > bs) { bs = v; best = a; } }
  return best;
}

/** Rotate a field by -angle about its centre so text lines become horizontal. Returns {data, Hback} (output->input mapping). */
export function rotateField(d, w, h, angle) {
  if (Math.abs(angle) < 0.0008) return { data: d, Hback: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const c = Math.cos(angle), s = Math.sin(angle), cx = w / 2, cy = h / 2;
  // point on output (x,y) came from input: rotate by +angle around centre (we undo a -angle skew)
  const Hb = [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy, 0, 0, 1];
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Hb[0] * x + Hb[1] * y + Hb[2], sy = Hb[3] * x + Hb[4] * y + Hb[5];
    out[y * w + x] = sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1 ? 0 : sample(d, w, h, sx, sy);
  }
  return { data: out, Hback: Hb };
}

export function composeH(A, B) { // A∘B : x -> A(B(x))
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return r;
}

/** Whole page pipeline from a gray photo. opts: {useQuad:boolean|undefined, quad?} */
export function preparePage(gray, w, h, opts = {}) {
  const det = opts.quad ? { quad: opts.quad, ok: true } : detectPageQuad(gray, w, h);
  const useQuad = opts.useQuad === undefined ? det.ok : opts.useQuad;
  let page, Hback;
  if (useQuad) { const dw = dewarp(gray, w, h, det.quad, opts.maxLong || 3000); page = dw; Hback = dw.Hback; }
  else {
    const k = Math.min(1, (opts.maxLong || 3000) / Math.max(w, h));
    if (k < 1) {
      const ow = Math.round(w * k), oh = Math.round(h * k), Hb = [1 / k, 0, 0, 0, 1 / k, 0, 0, 0, 1];
      page = { data: warpWithH(gray, w, h, Hb, ow, oh), w: ow, h: oh }; Hback = Hb;
    } else { page = { data: gray, w, h }; Hback = [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
  }
  const norm = flattenBackground(page.data, page.w, page.h);
  const ink = inkField(norm, page.w, page.h);
  const rules = removeRules(ink.d, page.w, page.h);
  const skew = opts.skew === false ? 0 : estimateSkew(ink.d, page.w, page.h);
  const rot = rotateField(ink.d, page.w, page.h, skew);
  // output(x,y) -> source photo: Hback ∘ rot.Hback
  const H = composeH(Hback, rot.Hback);
  return { d: rot.data, w: page.w, h: page.h, H, quad: det, usedQuad: useQuad, skew, rules, inkLevel: ink.inkLevel, contrast: ink.contrast, inkFrac: ink.inkFrac };
}
