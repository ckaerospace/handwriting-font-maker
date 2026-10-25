import fs from "fs";
import { loadImage, savePNG } from "./load.mjs";
import { rgbaToGray, preparePage } from "../../public/js/page.js";
import { segmentLines, chooseWordThreshold, wordsFromThreshold } from "../../public/js/segment.js";
import { PNG } from "pngjs";
const p = process.argv[2];
const gt = JSON.parse(fs.readFileSync(p + ".json"));
const im = loadImage(p + ".jpg");
const g = rgbaToGray(im.data, im.w, im.h);
const pg = preparePage(g, im.w, im.h, { maxLong: 2400 });
const t0 = Date.now();
const seg = segmentLines(pg.d, pg.w, pg.h);
console.log("seg ms", Date.now() - t0, "pitch", seg.pitch, "conf", seg.pitchConf?.toFixed?.(2), "lines", seg.lines.length, "xh", seg.xh);
const nwords = gt.transcript.split(/\s+/).filter(Boolean).length;
const thr = chooseWordThreshold(seg.lines, nwords);
console.log("expected lines", gt.lines.length, "words", nwords, "thr", thr.toFixed(3));
let tw = 0;
for (const L of seg.lines) { L.words = wordsFromThreshold(L, thr); tw += L.words.length; console.log(" line y", L.y0, L.y1, "base", L.base, "xh", L.xh, "words", L.words.length, "atoms", L.atoms.length, "sat", L.atoms.filter(i => seg.atoms[i].sat).length); }
console.log("total words", tw);
// overlay
const png = new PNG({ width: pg.w, height: pg.h });
for (let i = 0; i < pg.w * pg.h; i++) { const v = 255 - Math.round(pg.d[i] * 255); png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v; png.data[i * 4 + 3] = 255; }
const px = (x, y, c) => { if (x >= 0 && y >= 0 && x < pg.w && y < pg.h) { const k = (y * pg.w + x) * 4; png.data[k] = c[0]; png.data[k + 1] = c[1]; png.data[k + 2] = c[2]; } };
for (const L of seg.lines) {
  for (let x = 0; x < pg.w; x += 2) { px(x, L.y0, [255, 0, 0]); px(x, L.base, [0, 160, 0]); px(x, L.top, [0, 160, 0]); }
  for (const wd of L.words) for (let y = L.y0 + 3; y < L.y1 - 3; y++) { px(wd.x0, y, [0, 0, 255]); px(wd.x1, y, [0, 0, 255]); }
  for (const id of L.atoms) { const a = seg.atoms[id]; if (a.sat) for (let x = a.x0; x < a.x1; x++) { px(x, a.y0 - 1, [255, 0, 255]); } }
}
fs.writeFileSync(p + "_seg.png", PNG.sync.write(png));
