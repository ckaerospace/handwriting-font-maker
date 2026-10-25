// Segmentation: connected components -> text lines -> baseline/x-height -> satellites (dots) -> words.
import { median, quantile } from "./geom.js";

export function gaussSmooth1D(a, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let v = 0;
    for (let j = -r; j <= r; j++) { const q = i + j; if (q >= 0 && q < a.length) v += a[q] * k[j + r]; }
    o[i] = v;
  }
  return o;
}

/** 8-connected labelling of d > thr. Returns {labels, atoms} (atoms[0] unused, atoms[id] 1-based). */
export function labelComponents(d, w, h, thr = 0.5) {
  const labels = new Int32Array(w * h);
  const atoms = [null];
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (d[i] <= thr || labels[i]) continue;
    const id = atoms.length;
    let sp = 0, area = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, sx = 0, sy = 0;
    stack[sp++] = i; labels[i] = id;
    while (sp) {
      const p = stack[--sp]; const x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (d[q] > thr && !labels[q]) { labels[q] = id; stack[sp++] = q; }
        }
      }
    }
    atoms.push({ id, x0, x1: x1 + 1, y0, y1: y1 + 1, area, cx: sx / area, cy: sy / area, sat: 0, line: -1 });
  }
  return { labels, atoms };
}

function findPitch(prof, h, fallback) {
  const s = gaussSmooth1D(prof, 2);
  let mean = 0; for (let i = 0; i < h; i++) mean += s[i]; mean /= h;
  const z = new Float32Array(h); let v0 = 0;
  for (let i = 0; i < h; i++) { z[i] = s[i] - mean; v0 += z[i] * z[i]; }
  if (v0 <= 0) return { pitch: fallback, conf: 0 };
  const maxLag = Math.min(h >> 1, 700), minLag = 14;
  const ac = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) { let a = 0; for (let i = 0; i + lag < h; i++) a += z[i] * z[i + lag]; ac[lag] = a / v0 * (h / (h - lag)); }
  let best = 0, bl = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) if (ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > best) { best = ac[lag]; bl = lag; }
  if (!bl || best < 0.15) return { pitch: fallback, conf: best };
  // smallest peak lag with >= 0.8 of the best
  for (let lag = minLag + 1; lag < bl; lag++) if (ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] >= 0.8 * best) { bl = lag; break; }
  return { pitch: bl, conf: best };
}

/**
 * Segment a prepared page field.
 * Returns {labels, atoms, lines:[{y0,y1,base,xh,top,atoms:[ids],words:[{x0,x1}],gaps:[{x0,x1}], occ}], w,h,pitch,xh}
 */
export function segmentLines(d, w, h) {
  // clear an outer margin (page borders / table remnants)
  const m = Math.round(0.012 * Math.min(w, h));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < m || y < m || x >= w - m || y >= h - m) d[y * w + x] = 0;
  const { labels, atoms } = labelComponents(d, w, h, 0.5);
  // drop noise and page furniture
  const keep = [];
  for (let id = 1; id < atoms.length; id++) {
    const a = atoms[id], bw = a.x1 - a.x0, bh = a.y1 - a.y0;
    if (a.area < 6 || bh > 0.4 * h || bw > 0.7 * w) { a.dead = true; continue; }
    keep.push(a);
  }
  if (!keep.length) return { labels, atoms, lines: [], w, h, pitch: 0, xh: 0, empty: true };
  // row profile from kept atoms
  const prof = new Float32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const l = labels[y * w + x]; if (l && !atoms[l].dead) prof[y]++; }
  const bigH = keep.filter(a => a.area > median(keep.map(k => k.area))).map(a => a.y1 - a.y0);
  const fallbackPitch = Math.max(30, 2.6 * median(bigH.length ? bigH : keep.map(a => a.y1 - a.y0)));
  const { pitch, conf } = findPitch(prof, h, fallbackPitch);
  const sm = gaussSmooth1D(prof, Math.max(2, pitch / 12));
  const sm2 = gaussSmooth1D(prof, Math.max(1.5, pitch / 25));
  // peaks
  let maxv = 0; for (let i = 0; i < h; i++) if (sm[i] > maxv) maxv = sm[i];
  let peaks = [];
  const rad = Math.max(3, Math.round(pitch * 0.45));
  for (let y = 0; y < h; y++) {
    if (sm[y] < 0.12 * maxv) continue;
    let isMax = true;
    for (let k = Math.max(0, y - rad); k <= Math.min(h - 1, y + rad); k++) if (sm[k] > sm[y] || (sm[k] === sm[y] && k < y)) { isMax = false; break; }
    if (isMax) peaks.push(y);
  }
  // reject weak peaks relative to the median peak height
  if (peaks.length > 2) {
    const med = median(peaks.map(p => sm[p]));
    peaks = peaks.filter(p => sm[p] >= 0.25 * med);
  }
  if (!peaks.length) return { labels, atoms, lines: [], w, h, pitch, xh: 0, empty: true };
  const bounds = [];
  for (let i = 0; i < peaks.length - 1; i++) {
    let bm = peaks[i], bv = 1e18;
    for (let y = peaks[i]; y <= peaks[i + 1]; y++) if (sm2[y] < bv) { bv = sm2[y]; bm = y; }
    bounds.push(bm);
  }
  const lines = [];
  for (let i = 0; i < peaks.length; i++) {
    let y0 = i === 0 ? Math.max(0, Math.round(peaks[0] - 1.4 * pitch)) : bounds[i - 1];
    let y1 = i === peaks.length - 1 ? Math.min(h, Math.round(peaks[i] + 1.4 * pitch)) : bounds[i];
    lines.push({ y0, y1, peak: peaks[i], atoms: [], words: [], gaps: [] });
  }
  // assign atoms by centroid row
  for (const a of keep) {
    let best = -1;
    for (let i = 0; i < lines.length; i++) if (a.cy >= lines[i].y0 && a.cy < lines[i].y1) { best = i; break; }
    if (best < 0) { a.dead = true; continue; }
    a.line = best; lines[best].atoms.push(a.id);
  }
  // per-line core band (x-height) from profile of its atoms
  for (const L of lines) {
    const r0 = L.y0, r1 = L.y1, lp = new Float32Array(r1 - r0);
    for (const id of L.atoms) {
      const a = atoms[id];
      for (let y = a.y0; y < a.y1; y++) { if (y < r0 || y >= r1) continue; for (let x = a.x0; x < a.x1; x++) if (labels[y * w + x] === id) lp[y - r0]++; }
    }
    const ls = gaussSmooth1D(lp, 1.5);
    let pk = 0, pi = 0; for (let i = 0; i < ls.length; i++) if (ls[i] > pk) { pk = ls[i]; pi = i; }
    let t = pi, b = pi;
    while (t > 0 && ls[t - 1] >= 0.45 * pk) t--;
    while (b < ls.length - 1 && ls[b + 1] >= 0.45 * pk) b++;
    L.top = r0 + t; L.base = r0 + b + 1; L.xh = Math.max(6, L.base - L.top);
  }
  const xhs = lines.filter(l => l.atoms.length).map(l => l.xh);
  const xhAll = median(xhs);
  for (const L of lines) { if (L.xh < 0.55 * xhAll || L.xh > 1.7 * xhAll) { L.xhRaw = L.xh; L.xh = xhAll; L.top = L.base - xhAll; } }
  markSatellites(atoms, lines, xhAll);
  for (const L of lines) buildWords(L, atoms, labels, w);
  return { labels, atoms, lines: lines.filter(l => l.atoms.length), w, h, pitch, pitchConf: conf, xh: xhAll };
}

/** Dots above x-height (i, j, umlauts) become satellites of the main atom beneath them. */
export function markSatellites(atoms, lines, xhAll) {
  for (const L of lines) {
    const xh = L.xh || xhAll;
    const ids = L.atoms.map(i => atoms[i]);
    const small = a => (a.y1 - a.y0) < 0.55 * xh && (a.x1 - a.x0) < 0.85 * xh;
    for (const s of ids) {
      if (!small(s)) continue;
      if (s.cy > L.base - 0.55 * xh) continue; // sits low: period, comma
      let host = null, hd = 1e9;
      for (const m of ids) {
        if (m === s || small(m) || m.sat) continue;
        if (m.cy <= s.cy) continue;
        const gap = m.y0 - s.y1;
        if (gap > 1.0 * xh || gap < -0.5 * xh) continue;
        const cx = s.cx; const dx = cx < m.x0 ? m.x0 - cx : cx > m.x1 ? cx - m.x1 : 0;
        if (dx > 0.2 * xh) continue;
        const dist = Math.abs(cx - (m.x0 + m.x1) / 2) + gap * 0.5;
        if (dist < hd) { hd = dist; host = m; }
      }
      if (host) s.sat = host.id;
    }
  }
}

/** Column occupancy of the (non-satellite) atoms of a line and the word gaps. */
export function buildWords(L, atoms, labels, w) {
  const occ = new Float32Array(w);
  let x0 = w, x1 = 0;
  for (const id of L.atoms) {
    const a = atoms[id]; if (a.sat) continue;
    for (let y = a.y0; y < a.y1; y++) for (let x = a.x0; x < a.x1; x++) if (labels[y * w + x] === id) occ[x]++;
    if (a.x0 < x0) x0 = a.x0; if (a.x1 > x1) x1 = a.x1;
  }
  L.occ = occ; L.x0 = x0; L.x1 = x1;
  const gaps = [];
  let run = -1;
  for (let x = x0; x < x1; x++) {
    if (occ[x] === 0) { if (run < 0) run = x; } else if (run >= 0) { gaps.push({ x0: run, x1: x }); run = -1; }
  }
  L.gaps = gaps;
}

/** Cut a line into words with a gap threshold in x-heights. */
export function wordsFromThreshold(L, thrXh) {
  const thr = thrXh * L.xh;
  const words = []; let start = L.x0;
  for (const g of L.gaps) if (g.x1 - g.x0 >= thr) { words.push({ x0: start, x1: g.x0 }); start = g.x1; }
  words.push({ x0: start, x1: L.x1 });
  return words.filter(wd => wd.x1 > wd.x0);
}

/** Choose a gap threshold (xh units) so that the page has `target` words in total (or Otsu of log-gaps if no target). */
export function chooseWordThreshold(lines, target) {
  const gs = [];
  for (const L of lines) for (const g of L.gaps) gs.push((g.x1 - g.x0) / L.xh);
  const nLines = lines.length;
  if (target && gs.length) {
    const need = Math.max(0, target - nLines);
    const sorted = gs.slice().sort((a, b) => b - a);
    if (need <= 0) return sorted[0] + 1;
    if (need >= sorted.length) return Math.max(0.02, sorted[sorted.length - 1] - 0.001);
    const hi = sorted[need - 1], lo = sorted[need];
    return Math.max(0.02, (hi + lo) / 2);
  }
  // Otsu on log gap sizes
  const lg = gs.map(g => Math.log(Math.max(g, 0.02)));
  if (lg.length < 4) return 0.45;
  let best = 0, bt = Math.log(0.45);
  const lo = Math.min(...lg), hi = Math.max(...lg);
  for (let t = lo + 0.05; t < hi; t += 0.05) {
    const A = lg.filter(v => v < t), B = lg.filter(v => v >= t);
    if (!A.length || !B.length) continue;
    const ma = A.reduce((s, v) => s + v, 0) / A.length, mb = B.reduce((s, v) => s + v, 0) / B.length;
    const v = A.length * B.length * (ma - mb) * (ma - mb);
    if (v > best) { best = v; bt = t; }
  }
  return Math.min(0.8, Math.max(0.25, Math.exp(bt)));
}
