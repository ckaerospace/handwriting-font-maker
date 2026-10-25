import { runPage, score } from "./evalfn.mjs";
const r = runPage(process.argv[2]); const s = score(r);
console.log("lines seg", r.seg.lines.length, "gt lines", r.gt.lines.length, "cost", r.al.res.cost, "path", r.al.res.path.length, "toks", r.al.toks.length, "glyphs", s.glyphs);
console.log(r.seg.lines.map(l=>`xh=${l.xh?.toFixed(1)} atoms=${l.atoms?.length} y0=${l.y0|0} y1=${l.y1|0}`).join("\n"));
console.log(r.gt.lines);
console.log("pg", r.pg.w, r.pg.h, r.pg.inkFrac, r.pg.usedQuad);
