// No-transcript mode: Viterbi over candidate boundaries where every span is scored by the on-device classifier.
import { extractSample, sampleInput } from "./glyphs.js";
import { prepareLines, buildGraph, refineLineMetrics } from "./align.js";

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

/**
 * Returns {path:[{i,j,S,ch,lp,junk}], graph, toks}. Output shape mirrors alignWithTranscript so samplesFromAlignment works:
 * res.path entries {k,i,j,S}, toks[k]={ch,sp,nl}.
 */
export function recognize(seg, d, cls, meta, opts = {}) {
  prepareLines(seg);
  const g0 = opts.g0 ?? 0.45, onProgress = opts.onProgress || (() => {});
  const graph = buildGraph(seg, opts.graph);
  const { nodes, spans, lineFirst, lineLast } = graph;
  const Nn = nodes.length, chars = cls.chars, JUNK = cls.JUNK;
  // score every span once
  const total = spans.reduce((a, s) => a + s.length, 0); let done = 0;
  const lpBuf = new Float32Array(cls.ncls);
  for (let i = 0; i < Nn; i++) {
    for (const S of spans[i]) {
      if (S.W > 2.4) { S.skip = true; continue; }
      const smp = extractSample(seg, d, nodes[i].line, S.xs, S.xe);
      const inp = smp && sampleInput(smp);
      if (!inp) { S.skip = true; continue; }
      const l = cls.logits(inp.x, inp.g, lpBuf);
      let m = -1e9; for (let k = 0; k < l.length; k++) if (l[k] > m) m = l[k];
      let z = 0; for (let k = 0; k < l.length; k++) z += Math.exp(l[k] - m);
      const lz = Math.log(z) + m;
      let bi = -1, bv = -1e9; for (let k = 0; k < JUNK; k++) if (l[k] > bv) { bv = l[k]; bi = k; }
      S.ch = chars[bi]; S.lp = bv - lz; S.ljunk = l[JUNK] - lz;
      // second best for display
      done++;
    }
    if ((i & 31) === 0) onProgress(Math.min(1, i / Nn));
  }
  const INF = 1e30, f = new Float32Array(Nn).fill(INF), prev = new Int32Array(Nn).fill(-1), how = new Int8Array(Nn);
  f[0] = 0;
  const bcost = (n) => {
    if (n.kind === 2) return 0;
    const xh = seg.lines[n.line].xh;
    if (n.kind === 1) return 0.2 + 0.0; // natural gap, space decided afterwards
    return 1.2 * n.u; // cut inside ink: prefer low occupancy
  };
  const last = Nn - 1;
  for (let pass = 0; pass < 2; pass++) {
    const bridge = pass === 1; // second pass only if the page could not be crossed: allow skipping unrecognisable ink
    f.fill(INF); prev.fill(-1); how.fill(0); f[0] = 0;
    for (let i = 0; i < Nn; i++) {
      const cur = f[i]; if (cur >= INF) continue;
      const n = nodes[i];
      if (i === lineLast[n.line] && n.line + 1 < lineFirst.length) { const tn = lineFirst[n.line + 1]; if (cur < f[tn]) { f[tn] = cur; prev[tn] = i; how[tn] = 4; } }
      if (i + 1 < Nn && nodes[i + 1].line === n.line && i !== lineLast[n.line]) {
        const dist = ((nodes[i + 1].xl + nodes[i + 1].xr) - (n.xl + n.xr)) / 2 / seg.lines[n.line].xh;
        if (dist > 2.4 || bridge) { const c = cur + (dist > 2.4 ? 3 : 4 + 3 * dist); if (c < f[i + 1]) { f[i + 1] = c; prev[i + 1] = i; how[i + 1] = 5; } }
      }
      for (const S of spans[i]) {
        if (S.skip) continue;
        const wp = meta.wprior[S.ch] || [0, 0.35];
        const zw = (Math.log(S.W) - wp[0]) / Math.sqrt(wp[1] * wp[1] + 0.03);
        const gp = meta.gprior[S.ch];
        let c = 0.6 * -S.lp + 0.4 * Math.min(8, 0.5 * zw * zw) + 1.0 + bcost(nodes[S.j]);
        if (S.gapIn > 0) c += 2 + 3 * S.gapIn;
        // junk alternative: absorbs ink that is not a character (stray marks)
        const cj = 0.6 * -S.ljunk + 2.5 + 2.5 * S.W;
        const useJunk = cj < c;
        const cc = Math.min(c, cj) + cur;
        if (cc < f[S.j]) { f[S.j] = cc; prev[S.j] = i; how[S.j] = useJunk ? 3 : 1; S.useJunk = useJunk; }
      }
    }
    if (f[last] < INF) break;
  }
  const path = []; let i = last;
  while (i > 0 && prev[i] >= 0) {
    const pi = prev[i];
    if (how[i] === 1) { const S = spans[pi].find(s => s.j === i && !s.skip); path.push({ i: pi, j: i, S }); }
    i = pi;
  }
  path.reverse();
  // build tokens (with spaces from natural gaps) like the transcript path
  const toks = [], out = [];
  let lastLine = -1, lastEnd = -1, k = 0;
  for (const p of path) {
    const n = nodes[p.i], L = seg.lines[n.line];
    let sp = false, nl = false;
    if (toks.length) {
      if (n.line !== lastLine) { sp = true; nl = true; }
      else {
        // find a natural gap between previous end and this start
        const gapW = (p.S.xs - lastEnd) / L.xh;
        sp = gapW > g0;
      }
    }
    toks.push({ ch: p.S.ch, sp, nl });
    out.push({ k: k++, i: p.i, j: p.j, S: p.S });
    lastLine = n.line; lastEnd = p.S.xe;
  }
  return { graph, toks, res: { path: out, cost: f[last] } };
}
