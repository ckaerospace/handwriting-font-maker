import fs from "fs";
import { runPage, score } from "./evalfn.mjs";
const dir = process.argv[2] || "/workspace/hfm_test";
const names = fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
let T = 0, O = 0, L = 0; const rows = [];
for (const n of names) {
  try {
    const r = runPage(dir + "/" + n); const s = score(r);
    T += s.total; O += s.ok; L += s.near;
    rows.push(`${n.padEnd(22)} ${(s.acc*100).toFixed(1).padStart(5)}% (${s.ok}/${s.total}, loc ${s.near}) ${r.ms}ms mode=${r.gt.mode} quad=${r.pg.usedQuad} skew=${(r.pg.skew||0).toFixed?.(2)}  ${s.bad.slice(0,14).join(" ")}`);
  } catch (e) { rows.push(n + " ERROR " + e.message); }
}
console.log(rows.join("\n")); console.log(`TOTAL ${(O/T*100).toFixed(1)}% (${O}/${T}) located ${(L/T*100).toFixed(1)}%`);
