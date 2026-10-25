// Full-session accuracy: Session.prepare -> label (transcript or auto) -> per-sample correctness vs ground truth, flag quality, font-used-set accuracy.
import fs from "fs";
import { loadImage } from "./load.mjs";
import { makeSession } from "./node_session.mjs";
import { applyH } from "../../public/js/geom.js";
import { judge } from "../../public/js/glyphs.js";
const dir = process.argv[2] || "/workspace/hfm_test", mode = process.argv[3] || "transcript";
const names = fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
const T = { n: 0, ok: 0, flag: 0, wrong: 0, wrongFlag: 0, okFlag: 0, used: 0, usedOk: 0, usedOkAfter: 0, gtchars: 0, usedCov: 0, usedWrongUnflagged: 0 };
const rows = [];
for (const n of names) {
  const gt = JSON.parse(fs.readFileSync(`${dir}/${n}.json`)), im = loadImage(`${dir}/${n}.jpg`);
  const S = makeSession(); const t0 = Date.now();
  const info = S.prepare(im.data, im.w, im.h, {}); S.label(info.id, mode === "transcript" ? gt.transcript : "");
  const ms = Date.now() - t0, ph = S.photos[0], pg = ph.prep.pg, tol = gt.xh_photo * 0.9 * 1.1;
  const truth = new Map(); let ok = 0, flag = 0, wrong = 0, wf = 0, of = 0;
  for (const s of ph.samples) {
    const [px, py] = applyH(pg.H, (s.xs + s.xe) / 2, s.base - s.xh * 0.5);
    let best = null, bd = 1e9; for (const c of gt.gt) { const d = Math.hypot(c.x - px, (c.y - py) * 0.6); if (d < bd) { bd = d; best = c; } }
    const t = bd < tol ? best.ch : null; truth.set(s, t);
    const fl = !s.ch || judge(s, mode === "auto").flag, good = t != null && s.ch === t;
    if (good) ok++; else wrong++; if (fl) flag++; if (!good && fl) wf++; if (good && fl) of++;
  }
  const best = S.best(); let used = 0, usedOk = 0, uwu = 0;
  for (const [ch, s] of best) { used++; if (truth.get(s) === ch) usedOk++; else if (!judge(s, mode === "auto").flag) uwu++; }
  // simulate review: user fixes every flagged sample to ground truth (or deletes it if it is not a real glyph)
  for (const s of ph.samples) if (!s.ch || judge(s, mode === "auto").flag) { const t = truth.get(s); if (t) { s.ch = t; s.manual = true; } else s.deleted = true; }
  const best2 = S.best(); let usedOk2 = 0; for (const [ch, s] of best2) if (truth.get(s) === ch) usedOk2++;
  const gtset = new Set(gt.gt.map(c => c.ch)); 
  T.n += ph.samples.length; T.ok += ok; T.flag += flag; T.wrong += wrong; T.wrongFlag += wf; T.okFlag += of; T.used += used; T.usedOk += usedOk; T.usedOkAfter += best2.size ? usedOk2 : 0; T.usedWrongUnflagged += uwu; T.gtchars += gtset.size; T.usedCov += best.size;
  rows.push(`${n.padEnd(20)} samples ${String(ph.samples.length).padStart(3)} correct ${(100*ok/ph.samples.length).toFixed(0).padStart(3)}%  flagged ${String(flag).padStart(3)} (wrong ${wrong}, caught ${wf})  font chars ${best.size}/${gtset.size} correct ${usedOk}/${used} -> after fixing flags ${usedOk2}/${best2.size}  ${ms}ms`);
}
console.log(rows.join("\n"));
const p = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + "%";
console.log(`MODE ${mode}  pages ${names.length}  samples ${T.n}`);
console.log(`sample label accuracy ${p(T.ok, T.n)}`);
console.log(`flag recall (wrong samples that are flagged) ${p(T.wrongFlag, T.wrong)}, flag precision ${p(T.wrongFlag, T.flag)}, flagged share of all samples ${p(T.flag, T.n)}`);
console.log(`font glyph (best per char) correct without review ${p(T.usedOk, T.used)}; wrong AND unflagged ${T.usedWrongUnflagged}/${T.used}; correct after fixing only flagged ${p(T.usedOkAfter, T.used)}`);
