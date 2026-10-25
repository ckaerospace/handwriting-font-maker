// Transcript alignment: a Viterbi-style DP over candidate cut boundaries of all lines (reading order).
// Each transcript character takes one span between two boundaries. Costs: width prior, shape prior
// (height above baseline / below baseline), boundary cost (ink valley vs natural gap vs word gap), skips.
import { gaussSmooth1D } from "./segment.js";
import { median } from "./geom.js";

const MULTI = new Set(Array.from(":;\"%=+!?\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc()&\u20ac"));
const GENERIC_W = [0.0, 0.35], GENERIC_G = [1.0, 0.4, -0.1, 0.35, 1.2];
const INF = 1e30;

/** Per-line preparation: column arrays and candidate boundaries. Boundary: {xl,xr,kind,g,u,line}. kind 0 cut, 1 gap, 2 line start, 3 line end. */
export function prepareLines(seg) {
  const { atoms, labels, w } = seg;
  for (const L of seg.lines) {
    const topY = new Int32Array(w).fill(1 << 30), botY = new Int32Array(w).fill(-1);
    for (const id of L.atoms) {
      const a = atoms[id];
      for (let y = a.y0; y < a.y1; y++) for (let x = a.x0; x < a.x1; x++) if (labels[y * w + x] === id) { if (y < topY[x]) topY[x] = y; if (y + 1 > botY[x]) botY[x] = y + 1; }
    }
    L.topY = topY; L.botY = botY;
    if (L.slope === undefined) { L.slope = 0; L.base0 = L.base; }
  }
}

export function lineBase(L, x) { return L.base0 + L.slope * x; }

export function candidateBoundaries(L, li, opts = {}) {
  const xh = L.xh, x0 = L.x0, x1 = L.x1;
  const u = new Float32Array(L.occ.length);
  for (let x = x0; x < x1; x++) u[x] = L.occ[x] / xh;
  const us = gaussSmooth1D(u, Math.max(0.8, xh * 0.03));
  const B = [{ xl: x0, xr: x0, kind: 2, g: 0, u: 0, line: li }];
  for (const g of L.gaps) if (g.x0 > x0 && g.x1 < x1) B.push({ xl: g.x0, xr: g.x1, kind: 1, g: g.x1 - g.x0, u: 0, line: li });
  const r = Math.max(3, Math.round(0.5 * xh));
  const prom = opts.prominence ?? 0.07, umax = opts.umax ?? 0.9;
  const vs = [];
  for (let x = x0 + 2; x < x1 - 2; x++) {
    if (L.occ[x] === 0) continue;
    if (!(us[x] <= us[x - 1] && us[x] < us[x + 1])) continue;
    if (us[x] > umax) continue;
    let ml = 0, mr = 0;
    for (let k = 1; k <= r; k++) { if (x - k >= x0) ml = Math.max(ml, us[x - k]); if (x + k < x1) mr = Math.max(mr, us[x + k]); }
    if (Math.min(ml, mr) - us[x] < prom) continue;
    vs.push({ xl: x, xr: x, kind: 0, g: 0, u: Math.min(1, u[x]), line: li, us: us[x] });
  }
  // dedupe valleys closer than 0.12 xh keep the lowest
  vs.sort((a, b) => a.xl - b.xl);
  const kept = [];
  for (const v of vs) {
    const last = kept[kept.length - 1];
    if (last && v.xl - last.xl < Math.max(2, 0.14 * xh)) { if (v.us < last.us) kept[kept.length - 1] = v; } else kept.push(v);
  }
  for (const v of kept) {
    // drop valleys that sit inside/next to a natural gap
    if (B.some(b => b.kind === 1 && v.xl >= b.xl - 2 && v.xl <= b.xr + 2)) continue;
    B.push(v);
  }
  B.push({ xl: x1, xr: x1, kind: 3, g: 0, u: 0, line: li });
  B.sort((a, b) => a.xl - b.xl || a.kind - b.kind);
  // connectivity: no stretch of ink longer than 2.4 xh may lack a boundary (force a cut at the lowest occupancy)
  const maxStep = 2.4 * xh;
  for (let n = 0; n < B.length - 1; n++) {
    const a = B[n], b = B[n + 1], ma = (a.xl + a.xr) / 2, mb = (b.xl + b.xr) / 2;
    if (mb - ma <= maxStep) continue;
    if (a.kind === 1 || b.kind === 1) continue; // empty stretch, bridged in the DP
    const lo = Math.ceil(ma + 0.8 * xh), hi = Math.floor(Math.min(mb - 0.8 * xh, ma + maxStep));
    let bx = -1, bv = 1e9;
    for (let x = lo; x <= hi; x++) { if (us[x] < bv) { bv = us[x]; bx = x; } }
    if (bx < 0) bx = Math.round(ma + 1.5 * xh);
    B.splice(n + 1, 0, { xl: bx, xr: bx, kind: 0, g: 0, u: Math.min(1, u[bx] || 0), line: li, us: bv, forced: true });
  }
  return B;
}

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

/**
 * Build the boundary graph for all lines.
 * Returns {nodes, spans:Array<Array<{j, W, top, bot, gapIn, ...}>>, lineFirst, lineLast}
 */
export function buildGraph(seg, opts = {}) {
  const nodes = [], lineFirst = [], lineLast = [];
  seg.lines.forEach((L, li) => {
    const B = candidateBoundaries(L, li, opts);
    lineFirst.push(nodes.length); for (const b of B) nodes.push(b); lineLast.push(nodes.length - 1);
  });
  const spans = nodes.map(() => []);
  seg.lines.forEach((L, li) => {
    const xh = L.xh, f = lineFirst[li], l = lineLast[li];
    for (let i = f; i <= l; i++) {
      const bi = nodes[i], mi = (bi.xl + bi.xr) / 2;
      for (let j = i + 1; j <= l; j++) {
        const bj = nodes[j], mj = (bj.xl + bj.xr) / 2;
        const W = mj - mi;
        if (W > 3.4 * xh) break;
        const xs = bi.xr, xe = bj.xl;
        if (xe - xs < 2 || W < 0.2 * xh) continue;
        let top = 1 << 30, bot = -1, cmass = 0, gapIn = 0;
        for (let x = xs; x < xe; x++) { if (L.topY[x] < top) top = L.topY[x]; if (L.botY[x] > bot) bot = L.botY[x]; }
        if (bot < 0) continue; // empty
        for (let m = i + 1; m < j; m++) if (nodes[m].kind === 1) gapIn += nodes[m].g / xh;
        const xc = (xs + xe) / 2, base = lineBase(L, xc);
        spans[i].push({ j, W: W / xh, top: (base - top) / xh, bot: (base - bot) / xh, gapIn, xs, xe, ncut: 0 });
      }
    }
  });
  return { nodes, spans, lineFirst, lineLast };
}

/** transcript -> tokens [{ch, sp (space before), nl (newline before)}] */
export function tokenize(text) {
  const toks = []; let sp = false, nl = false, hasNL = false;
  for (const ch of text.replace(/\r/g, "")) {
    if (ch === "\n") { nl = true; sp = true; hasNL = true; continue; }
    if (/\s/.test(ch)) { sp = true; continue; }
    toks.push({ ch, sp: toks.length ? sp : false, nl: toks.length ? nl : false }); sp = false; nl = false;
  }
  return { toks, hasNL };
}

export function charPriors(meta, ch) {
  const w = meta.wprior[ch] || GENERIC_W, g = meta.gprior[ch] || GENERIC_G;
  return { mw: w[0], sw: w[1], mt: g[0], st: g[1], mb: g[2], sb: g[3] };
}

/** Run the alignment. Returns {path:[{k, i, j, span}], cost}. */
export function alignDP(seg, graph, toks, hasNL, meta, P = {}) {
  const { nodes, spans, lineFirst, lineLast } = graph;
  const Nn = nodes.length, Nt = toks.length;
  const prm = Object.assign({ lw: 1.0, lg: 0.8, kappa: 3.0, g0: 0.45, gs: 0.12, skipTok: 6.0, junkBase: 3.5, junkW: 2.5, gapIn: 2.0, wInfl: 0.18, gInfl: 0.2, lineNoNL: 2.5, lineFree: 0.4 }, P);
  const pri = toks.map(t => charPriors(meta, t.ch));
  const multi = toks.map(t => MULTI.has(t.ch));
  const f = new Float32Array((Nt + 1) * Nn).fill(INF);
  const prevN = new Int32Array((Nt + 1) * Nn).fill(-1);
  const op = new Int8Array((Nt + 1) * Nn);
  f[0] = 0;
  const lineOf = nodes.map(n => n.line);
  const bcost = (n, sp) => {
    if (n.kind === 2) return 0;
    const xh = seg.lines[n.line].xh;
    if (n.kind === 1) {
      const gam = n.g / xh, pw = sigmoid((gam - prm.g0) / prm.gs);
      return sp ? -Math.log(pw + 1e-3) : -Math.log(1 - pw + 1e-3) * 0.9;
    }
    return sp ? 7 : prm.kappa * n.u;
  };
  for (let k = 0; k <= Nt; k++) {
    const base = k * Nn;
    for (let i = 0; i < Nn; i++) {
      const cur = f[base + i];
      if (cur >= INF) continue;
      const n = nodes[i], xh = seg.lines[n.line].xh;
      const sp = spans[i];
      // bridge over a wide empty stretch to the next boundary of the same line
      if (i + 1 < Nn && nodes[i + 1].line === n.line && i !== lineLast[n.line]) {
        const dist = ((nodes[i + 1].xl + nodes[i + 1].xr) - (n.xl + n.xr)) / 2 / xh;
        if (dist > 2.4) { const c = cur + 3 + 0.5 * dist; if (c < f[base + i + 1]) { f[base + i + 1] = c; prevN[base + i + 1] = i; op[base + i + 1] = 5; } }
      }
      // junk span
      for (let s = 0; s < sp.length; s++) {
        const S = sp[s]; if (S.W > 2.6) continue;
        const c = cur + prm.junkBase + prm.junkW * S.W;
        if (c < f[base + S.j]) { f[base + S.j] = c; prevN[base + S.j] = i; op[base + S.j] = 3; }
      }
      // line edge
      if (i === lineLast[n.line] && n.line + 1 < lineFirst.length) {
        const tn = lineFirst[n.line + 1];
        let c = cur;
        if (k < Nt) c += hasNL ? (toks[k].nl ? 0 : prm.lineNoNL) : prm.lineFree; else c += 0;
        if (c < f[base + tn]) { f[base + tn] = c; prevN[base + tn] = i; op[base + tn] = 4; }
      }
      if (k === Nt) continue;
      // skip token
      {
        const c = cur + prm.skipTok, id = (k + 1) * Nn + i;
        if (c < f[id]) { f[id] = c; prevN[id] = i; op[id] = 2; }
      }
      // match token
      const bc = bcost(n, toks[k].sp);
      const p = pri[k], isM = multi[k];
      for (let s = 0; s < sp.length; s++) {
        const S = sp[s];
        const zw = (Math.log(S.W) - p.mw) / Math.sqrt(p.sw * p.sw + prm.wInfl * prm.wInfl);
        const zt = (S.top - p.mt) / Math.sqrt(p.st * p.st + prm.gInfl * prm.gInfl);
        const zb = (S.bot - p.mb) / Math.sqrt(p.sb * p.sb + prm.gInfl * prm.gInfl);
        let c = prm.lw * Math.min(8, 0.5 * zw * zw) + prm.lg * (Math.min(6, 0.5 * zt * zt) + Math.min(6, 0.5 * zb * zb));
        if (S.gapIn > 0 && !isM) c += prm.gapIn + 3 * S.gapIn;
        c += cur + bc;
        const id = (k + 1) * Nn + S.j;
        if (c < f[id]) { f[id] = c; prevN[id] = i; op[id] = 1; }
      }
    }
  }
  const lastNode = Nn - 1;
  const total = f[Nt * Nn + lastNode];
  if (total >= INF) return { path: [], cost: INF };
  // backtrack
  const path = [];
  let k = Nt, i = lastNode;
  while (!(k === 0 && i === 0)) {
    const id = k * Nn + i, o = op[id], pn = prevN[id];
    if (pn < 0) break;
    if (o === 1) {
      const S = spans[pn].find(s => s.j === i);
      path.push({ k: k - 1, i: pn, j: i, S });
      k--; i = pn;
    } else if (o === 2) { path.push({ k: k - 1, skipped: true }); k--; i = pn; }
    else { i = pn; }
  }
  path.reverse();
  return { path, cost: total };
}

/** Refit per-line baseline/x-height/slope from aligned glyphs. Returns true if anything changed notably. */
export function refineLineMetrics(seg, graph, path, toks, meta) {
  let changed = 0;
  const byLine = seg.lines.map(() => ({ bx: [], by: [], xt: [] }));
  const BASE_CH = new Set(Array.from("abcdehiklmnorstuvwxzABCDEFGHIKLMNORSTUVWXZ0123456789"));
  const XH_CH = new Set(Array.from("acemnorsuvwxz"));
  for (const p of path) {
    if (p.skipped) continue;
    const ch = toks[p.k].ch, n = graph.nodes[p.i], S = p.S, L = seg.lines[n.line];
    const xc = (S.xs + S.xe) / 2;
    if (BASE_CH.has(ch)) {
      // robust bottom: median of per-column bottoms over the central 60% of span
      const bs = []; const a = S.xs + 0.2 * (S.xe - S.xs), b = S.xs + 0.8 * (S.xe - S.xs);
      for (let x = Math.ceil(a); x < b; x++) if (L.botY[x] > 0) bs.push(L.botY[x]);
      if (bs.length) { bs.sort((u, v) => u - v); byLine[n.line].bx.push(xc); byLine[n.line].by.push(bs[Math.floor(bs.length * 0.75)]); }
    }
    if (XH_CH.has(ch)) byLine[n.line].xt.push({ xc, top: S.top });
  }
  seg.lines.forEach((L, li) => {
    const d = byLine[li];
    if (d.by.length >= 5) {
      // Theil-Sen
      const sl = [];
      for (let a = 0; a < d.bx.length; a++) for (let b = a + 1; b < d.bx.length; b++) if (Math.abs(d.bx[b] - d.bx[a]) > 4 * L.xh) sl.push((d.by[b] - d.by[a]) / (d.bx[b] - d.bx[a]));
      let slope = sl.length >= 3 ? median(sl) : 0;
      slope = Math.max(-0.12, Math.min(0.12, slope));
      const ic = d.by.map((y, i) => y - slope * d.bx[i]);
      const base0 = median(ic);
      if (Math.abs(base0 - L.base0) > 0.5 || Math.abs(slope - L.slope) > 0.002) changed++;
      L.base0 = base0; L.slope = slope;
    }
    if (d.xt.length >= 4) {
      // x-height = median of (top above baseline) * xh over x-height letters
      const tops = d.xt.map(t => t.top * L.xh);
      const xh = median(tops);
      if (xh > 6 && Math.abs(xh - L.xh) > 0.5) { L.xh = xh; changed++; }
    }
  });
  return changed;
}

/** Full labelling with a transcript. Iterates metric refinement. */
export function alignWithTranscript(seg, text, meta, opts = {}) {
  prepareLines(seg);
  const { toks, hasNL } = tokenize(text);
  let graph, res, iters = opts.iters ?? 3;
  for (let it = 0; it < iters; it++) {
    graph = buildGraph(seg, opts.graph);
    res = alignDP(seg, graph, toks, hasNL, meta, opts.dp);
    if (it < iters - 1) { const ch = refineLineMetrics(seg, graph, res.path, toks, meta); if (!ch) break; }
  }
  return { graph, res, toks };
}
