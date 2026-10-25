import { runPage, score } from "./evalfn.mjs";
for (const p of process.argv.slice(2)) {
  const r = runPage(p);
  const s = score(r);
  console.log(p.split("/").pop(), "ms", r.ms, "cost", r.al.res.cost.toFixed(1), "toks", r.al.toks.length, "glyphs", s.glyphs, "acc", (s.acc * 100).toFixed(1) + "%", `(${s.ok}/${s.total}, located ${s.near})`);
  console.log("  bad:", s.bad.slice(0, 40).join(" "));
}
