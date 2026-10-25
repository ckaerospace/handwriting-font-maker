import fs from "fs";
import { loadImage } from "./load.mjs";
import { Classifier } from "../../public/js/classifier.js";
import { rgbaToGray, preparePage } from "../../public/js/page.js";
import { segmentLines, chooseWordThreshold } from "../../public/js/segment.js";
import { recognize } from "../../public/js/recognize.js";
import { applyH } from "../../public/js/geom.js";
import { lineBase } from "../../public/js/align.js";
const meta = JSON.parse(fs.readFileSync("public/model/cls.json"));
const buf = fs.readFileSync("public/model/cls.f16");
const cls = new Classifier(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
let T = 0, O = 0;
for (const p of process.argv.slice(2)) {
  const gt = JSON.parse(fs.readFileSync(p + ".json")); const im = loadImage(p + ".jpg");
  const pg = preparePage(rgbaToGray(im.data, im.w, im.h), im.w, im.h, { maxLong: 2400 });
  const seg = segmentLines(pg.d, pg.w, pg.h);
  const nw = gt.transcript.split(/\s+/).length; const thr = chooseWordThreshold(seg.lines, nw);
  const t0 = Date.now(); const r = recognize(seg, pg.d, cls, meta, { g0: thr }); const ms = Date.now() - t0;
  const glyphs = r.res.path.map(pp => { const n = r.graph.nodes[pp.i], L = seg.lines[n.line]; const xc = (pp.S.xs + pp.S.xe) / 2; const [x, y] = applyH(pg.H, xc, lineBase(L, xc) - L.xh / 2); return { ch: r.toks[pp.k].ch, x, y }; });
  const tol = gt.xh_photo * 0.9 * 1.1; let ok = 0, near = 0;
  for (const c of gt.gt) { let b = -1, bd = 1e9; glyphs.forEach((g, i) => { const d = Math.hypot(g.x - c.x, (g.y - c.y) * 0.6); if (d < bd) { bd = d; b = i; } }); if (b >= 0 && bd < tol) { near++; if (glyphs[b].ch === c.ch) ok++; } }
  T += gt.gt.length; O += ok;
  console.log(p.split("/").pop(), (ok / gt.gt.length * 100).toFixed(1) + "%", `(${ok}/${gt.gt.length}, located ${near}) ${ms}ms glyphs ${glyphs.length}`);
}
console.log("TOTAL", (O / T * 100).toFixed(1) + "%");
