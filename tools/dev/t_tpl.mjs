import fs from "fs";
import { loadImage } from "./load.mjs";
import { makeSession } from "./node_session.mjs";
const tpl = JSON.parse(fs.readFileSync("public/template/template.json"));
for (const n of process.argv.slice(2)) {
  const S = makeSession(); const im = loadImage(`/workspace/hfm_test/tpl/${n}.jpg`);
  const t = Date.now(); const r = S.prepareTemplate(im.data, im.w, im.h, tpl);
  const v = S.views(); const g = v.glyphs;
  const agree = g.filter(x => x.top === x.ch).length, flagged = g.filter(x => x.flag).length;
  console.log(n, `quad=${r.usedQuad} cells filled ${r.filled}/${r.cells}`, `CNN top1 agrees ${agree}/${g.length}`, `flagged ${flagged}`, `ms ${Date.now() - t}`, "missing", v.missing.join(""));
  const out = await S.build({ name: "Tpl " + n }); fs.writeFileSync(`/workspace/hfm_out/tpl_${n}.ttf`, out.ttf); fs.writeFileSync(`/workspace/hfm_out/tpl_${n}.otf`, out.otf);
}
