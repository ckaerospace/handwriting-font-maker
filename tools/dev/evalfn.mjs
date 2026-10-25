import fs from "fs";
import { loadImage } from "./load.mjs";
import { rgbaToGray, preparePage } from "../../public/js/page.js";
import { segmentLines, chooseWordThreshold } from "../../public/js/segment.js";
import { alignWithTranscript, lineBase } from "../../public/js/align.js";
import { applyH } from "../../public/js/geom.js";
export const meta = JSON.parse(fs.readFileSync("public/model/cls.json"));

export function runPage(p, { transcript, dp = {}, pageOpts = {}, iters } = {}) {
  const gt = JSON.parse(fs.readFileSync(p + ".json"));
  const im = loadImage(p + ".jpg");
  const g = rgbaToGray(im.data, im.w, im.h);
  const t0 = Date.now();
  const pg = preparePage(g, im.w, im.h, Object.assign({ maxLong: 2400 }, pageOpts));
  const seg = segmentLines(pg.d, pg.w, pg.h);
  const text = transcript ?? gt.transcript;
  const nwords = text.split(/\s+/).filter(Boolean).length;
  const thr = chooseWordThreshold(seg.lines, nwords);
  const al = alignWithTranscript(seg, text, meta, { dp: Object.assign({ g0: thr }, dp), iters });
  const ms = Date.now() - t0;
  return { gt, pg, seg, al, thr, ms };
}

/** Score vs ground truth: map aligned glyph centres back to photo coordinates. */
export function score(r) {
  const { gt, pg, seg, al } = r;
  const glyphs = [];
  for (const p of al.res.path) {
    if (p.skipped) continue;
    const S = p.S, n = al.graph.nodes[p.i], L = seg.lines[n.line];
    const xc = (S.xs + S.xe) / 2;
    const yc = lineBase(L, xc) - L.xh * 0.5;
    const [px, py] = applyH(pg.H, xc, yc);
    glyphs.push({ ch: al.toks[p.k].ch, x: px, y: py, line: n.line });
  }
  const tol = gt.xh_photo * 0.9;
  let ok = 0, near = 0, total = 0; const bad = [];
  const claimed = new Set();
  for (const c of gt.gt) {
    total++;
    let best = -1, bd = 1e9;
    glyphs.forEach((g, i) => { const d = Math.hypot(g.x - c.x, (g.y - c.y) * 0.6); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && bd < tol * 1.1) { near++; if (glyphs[best].ch === c.ch) ok++; else bad.push(c.ch + "->" + glyphs[best].ch); }
    else bad.push(c.ch + "->none");
  }
  return { total, ok, near, acc: ok / total, glyphs: glyphs.length, bad };
}
