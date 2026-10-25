// End-to-end analysis and font model assembly (DOM free; runs in a worker or in Node).
import { rgbaToGray, preparePage } from "./page.js";
import { segmentLines, chooseWordThreshold } from "./segment.js";
import { alignWithTranscript } from "./align.js";
import { samplesFromAlignment, extractSample, fillConfidence, judge, outlineOf } from "./glyphs.js";
import { layout, splineToTT } from "./font.js";
import { lineBase } from "./align.js";

export const CHARSETS = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  lower: "abcdefghijklmnopqrstuvwxyz".split(""),
  digits: "0123456789".split(""),
  punct: ".,;:!?'\"-()&@#%+=/".split(""),
  german: "\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df\u20ac".split(""),
};
export const ALL_CHARS = [].concat(...Object.values(CHARSETS));

export const HINTS = [
  "The quick brown fox jumps over the lazy dog.",
  "Pack my box with five dozen liquor jugs!",
  "Sphinx of black quartz, judge my vow.",
  "Zw\u00f6lf Boxk\u00e4mpfer jagen Viktor quer \u00fcber den gro\u00dfen Sylter Deich.",
  "\u00c4rger mit \u00d6l und \u00dcbung kostet 15\u20ac, 20% mehr (ja/nein)?",
  "Mail: anna@web.de #1 + 2 = 3 & 4-5; \"Hallo\": 'ok'!",
  "JACK QUIZ: FLY WHEN HEX BDG NOT KVP.",
];

/** Greedy text suggestions covering the missing characters. */
export function suggestText(missing, max = 3) {
  const need = new Set(missing); const out = [];
  while (need.size && out.length < max) {
    let best = null, bs = 0;
    for (const h of HINTS) { const sc = Array.from(new Set(h)).filter(c => need.has(c)).length; if (sc > bs) { bs = sc; best = h; } }
    if (!best) break;
    out.push(best); for (const c of best) need.delete(c);
  }
  return out;
}

/** Prepare one photo: find the page, flatten and segment. */
export function preparePhoto(rgba, w, h, opts = {}) {
  const gray = rgbaToGray(rgba, w, h);
  const pg = preparePage(gray, w, h, { maxLong: opts.maxLong ?? 2400, useQuad: opts.useQuad, skew: opts.skew });
  if (opts.noSegment) return { pg, seg: null };
  const seg = segmentLines(pg.d, pg.w, pg.h);
  return { pg, seg };
}

/** Label with a transcript (aligned) and compute classifier confidence. */
export function labelWithTranscript(prep, text, meta, cls) {
  const { seg, pg } = prep;
  const nwords = text.split(/\s+/).filter(Boolean).length;
  const thr = chooseWordThreshold(seg.lines, nwords);
  const al = alignWithTranscript(seg, text, meta, { dp: { g0: thr } });
  const samples = samplesFromAlignment(seg, pg.d, al, cls);
  return { al, samples, cost: al.res.cost };
}

/** Score for choosing the best sample per character. */
export function sampleScore(s, meta) {
  const j = judge(s);
  let sc = j.conf;
  sc -= 0.08 * ((s.cutL ? 1 : 0) + (s.cutR ? 1 : 0));
  if (s.edgeL || s.edgeR) sc -= 0.03;
  const wp = meta && meta.wprior[s.ch];
  if (wp) { const wpx = (s.xe - s.xs) / s.xh; const z = Math.abs(Math.log(Math.max(0.05, wpx)) - wp[0]) / Math.max(0.15, wp[1]); sc -= 0.04 * Math.min(4, z); }
  if (s.pinned) sc += 10;
  return sc;
}

/** Pick one sample per character from all non-deleted samples. */
export function chooseBest(samples, meta) {
  const best = new Map();
  for (const s of samples) {
    if (s.deleted || !s.ch || s.ch === " ") continue;
    s._score = sampleScore(s, meta);
    const b = best.get(s.ch);
    if (!b || s._score > b._score) best.set(s.ch, s);
  }
  return best;
}

export function missingChars(best) { return ALL_CHARS.filter(c => !best.has(c)); }

/** Median word gap in font units, from the first photo's lines (fallback 300). */
export function measureSpace(preps) {
  const gs = [];
  for (const p of preps) for (const L of p.seg.lines) for (const g of L.gaps) { const r = (g.x1 - g.x0) / L.xh; if (r > 0.45 && r < 2.2) gs.push(r); }
  if (gs.length < 4) return 300;
  gs.sort((a, b) => a - b);
  return Math.round(Math.max(220, Math.min(480, gs[Math.floor(gs.length / 2)] * 500 * 0.95)));
}

/** Build the layout model for the current best glyph set. */
export function buildModel(best, params, fallback = null) {
  const specs = [];
  for (const [ch, s] of best) {
    const cs = outlineOf(s, { smooth: params.smooth ?? 0.6, thickness: params.thickness ?? 0 });
    if (!cs.length) continue;
    specs.push({ ch, contours: cs.map(c => splineToTT(c.pts)), cutL: !!s.cutL && !!params.joinCursive, cutR: !!s.cutR && !!params.joinCursive });
  }
  if (fallback) for (const [ch, g] of Object.entries(fallback)) if (!best.has(ch)) specs.push({ ch, contours: g.contours.map(c => c.map(p => p.slice())), fallback: true, adv: g.adv });
  return layout(specs, params);
}
