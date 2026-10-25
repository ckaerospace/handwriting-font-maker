// Glyph samples: pixel ownership by column span, classifier confidence, outlines in font units.
import { glyphInput } from "./classifier.js";
import { traceField, area } from "./trace.js";
import { lineBase } from "./align.js";

export const XH_UNITS = 500; // x-height in font units (UPM 1000)

/** Cut a glyph out of the prepared page: columns [xs,xe) of a text line plus satellites (dots) whose centre lies inside. */
export function extractSample(seg, d, line, xs, xe) {
  const { labels, atoms, w, h } = seg, L = seg.lines[line];
  xs = Math.round(xs); xe = Math.round(xe);
  const owned = [];
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (const id of L.atoms) {
    const a = atoms[id];
    const whole = a.sat ? (a.cx >= xs && a.cx < xe) : false;
    if (!whole && (a.sat || a.x1 <= xs || a.x0 >= xe)) continue;
    const ax0 = whole ? a.x0 : Math.max(a.x0, xs), ax1 = whole ? a.x1 : Math.min(a.x1, xe);
    for (let y = a.y0; y < a.y1; y++) for (let x = ax0; x < ax1; x++) if (labels[y * w + x] === id) {
      owned.push(y * w + x);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (!owned.length) return null;
  const m = 3; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, mask = new Uint8Array(cw * ch);
  for (const i of owned) mask[(((i / w) | 0) - y0) * cw + (i % w) - x0] = 1;
  // include the anti-aliased fringe next to owned pixels (unlabelled pixels only)
  const data = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const gi = (y + y0) * w + x + x0;
    if (mask[y * cw + x]) { data[y * cw + x] = d[gi]; continue; }
    if (labels[gi] !== 0 || d[gi] <= 0) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < ch && xx >= 0 && xx < cw && mask[yy * cw + xx]) { near = true; break; } }
    if (near) data[y * cw + x] = d[gi];
  }
  const xc = (xs + xe) / 2;
  return { line, xs, xe, x0, y0, w: cw, h: ch, d: data, mask, base: lineBase(L, xc), slope: L.slope || 0, xh: L.xh, inkPx: owned.length };
}

/** Classifier input from a sample. */
export function sampleInput(s) {
  const reg = { x0: 0, x1: s.w, y0: 0, y1: s.h };
  return glyphInput(s.d, s.w, reg, s.base - s.y0, s.xh);
}

/** Run the classifier on a sample; returns {lp: Float32Array log-probs} or null. */
export function classify(cls, s) {
  const inp = sampleInput(s); if (!inp) return null;
  const l = cls.logits(inp.x, inp.g); // fresh array per call
  const lp = Float32Array.from(l);
  let m = -1e9; for (const v of lp) if (v > m) m = v;
  let z = 0; for (const v of lp) z += Math.exp(v - m);
  const lz = Math.log(z) + m; for (let i = 0; i < lp.length; i++) lp[i] -= lz;
  return lp;
}

/** Convert aligned path to samples. */
export function samplesFromAlignment(seg, d, al, cls) {
  const out = [];
  const idx = new Map(cls ? cls.chars.map((c, i) => [c, i]) : []);
  for (const p of al.res.path) {
    if (p.skipped) continue;
    const n = al.graph.nodes[p.i], nj = al.graph.nodes[p.j];
    const smp = extractSample(seg, d, n.line, p.S.xs, p.S.xe);
    if (!smp) continue;
    smp.ch = al.toks[p.k].ch; smp.cutL = n.kind === 0; smp.cutR = nj.kind === 0; smp.tok = p.k;
    smp.edgeL = n.kind === 2; smp.edgeR = nj.kind === 3;
    fillConfidence(smp, cls, idx);
    out.push(smp);
  }
  return out;
}

export function fillConfidence(smp, cls, idx) {
  smp.p = null; smp.top = null; smp.pTop = null;
  if (!cls) return;
  idx = idx || new Map(cls.chars.map((c, i) => [c, i]));
  const lp = classify(cls, smp); if (!lp) return;
  const k = idx.get(smp.ch);
  smp.p = k === undefined ? null : Math.exp(lp[k]);
  let bi = 0; for (let i = 1; i < lp.length; i++) if (lp[i] > lp[bi]) bi = i;
  smp.top = bi === cls.JUNK ? "?" : cls.chars[bi]; smp.pTop = Math.exp(lp[bi]);
}

/** Case/shape confusables: lookalikes that the classifier cannot tell apart on its own. */
const SAME = [["o", "O", "0"], ["s", "S"], ["c", "C"], ["v", "V"], ["w", "W"], ["x", "X"], ["z", "Z"], ["u", "U"], ["p", "P"], ["k", "K"], ["l", "I", "1", "|"], ["i", "j"], [".", ","], ["'", "`", "\u2019"], ["-", "\u2013"]];
export function lookalike(a, b) { return SAME.some(g => g.includes(a) && g.includes(b)); }

/** 0..1 confidence, and a short reason string when low. */
export function judge(smp, strict = false) {
  if (smp.p === null) return { conf: 0.5, flag: false };
  let conf = smp.p;
  if (smp.top && smp.top !== smp.ch && smp.pTop > 0.6 && !lookalike(smp.top, smp.ch)) conf = Math.min(conf, 0.1);
  else if (smp.top && lookalike(smp.top, smp.ch)) conf = Math.max(conf, 0.5);
  // flag only strong disagreement (measured: recall 94% of wrong labels, 18% of all samples flagged)
  // strict (no transcript): labels are guesses, so flag everything the classifier is not sure about (measured: recall 79%, 36% flagged)
  const flag = (strict && conf < 0.5) || (smp.top && smp.top !== smp.ch && smp.pTop > 0.85 && !lookalike(smp.top, smp.ch)) || (conf < 0.05 && !(smp.top && lookalike(smp.top, smp.ch)));
  return { conf, flag, reason: flag ? (smp.top && smp.top !== "?" ? `looks like "${smp.top}"` : "unclear shape") : "" };
}

/** Outline of a sample in font units (y up, baseline 0): [{pts:[[x,y]], hole}] with TrueType winding (outer clockwise). */
export function outlineOf(s, opts = {}) {
  const th = opts.thickness ?? 0; // -1..1
  const iso = 0.5 - 0.22 * th;
  const polys = traceField(s.d, s.w, s.h, { up: 3, sigma: opts.smooth ?? 0.6, iso, eps: opts.eps ?? 0.16 });
  const sc = XH_UNITS / s.xh;
  const res = [];
  for (const P of polys) {
    const pts = P.pts.map(([x, y]) => { const gx = x + s.x0, gy = y + s.y0; return [gx * sc, (s.base + s.slope * (gx - (s.xs + s.xe) / 2) - gy) * sc]; });
    // orientation after the y flip: positive signed area = counter-clockwise
    const a = area(pts); const wantCW = !P.hole;
    if ((a < 0) !== wantCW) pts.reverse();
    res.push({ pts, hole: P.hole });
  }
  return res;
}
