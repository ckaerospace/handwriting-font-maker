import { runPage } from "./evalfn.mjs";
import { prepareLines, buildGraph } from "../../public/js/align.js";
import fs from "fs";
import { loadImage } from "./load.mjs";
import { rgbaToGray, preparePage } from "../../public/js/page.js";
import { segmentLines } from "../../public/js/segment.js";
const p = process.argv[2];
const im = loadImage(p + ".jpg"); const g = rgbaToGray(im.data, im.w, im.h);
const pg = preparePage(g, im.w, im.h, { maxLong: 2400 }); const seg = segmentLines(pg.d, pg.w, pg.h);
prepareLines(seg); const G = buildGraph(seg);
seg.lines.forEach((L, li) => {
  const f = G.lineFirst[li], l = G.lineLast[li]; const reach = new Set([f]);
  for (let i = f; i <= l; i++) if (reach.has(i)) for (const s of G.spans[i]) reach.add(s.j);
  console.log("line", li, "nodes", l - f + 1, "reach last", reach.has(l), "xh", L.xh);
  if (!reach.has(l)) { for (let i = f; i <= l; i++) console.log("  ", i - f, G.nodes[i].kind, G.nodes[i].xl, G.nodes[i].xr, reach.has(i), G.spans[i].length); }
});
