import fs from "fs";
import { Classifier } from "../../public/js/classifier.js";
const meta = JSON.parse(fs.readFileSync("public/model/cls.json"));
const buf = fs.readFileSync("public/model/cls.f16");
const c = new Classifier(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const ref = JSON.parse(fs.readFileSync("/workspace/hfm_parity.json"));
let maxd = 0;
for (let i = 0; i < ref.x.length; i++) {
  const l = c.logits(Float32Array.from(ref.x[i]), Float32Array.from(ref.g[i]));
  for (let k = 0; k < l.length; k++) maxd = Math.max(maxd, Math.abs(l[k] - ref.logits[i][k]));
}
console.log("max |logit diff| vs PyTorch:", maxd);
const t = Date.now(); const x = Float32Array.from(ref.x[0]), g = Float32Array.from(ref.g[0]);
for (let i = 0; i < 2000; i++) c.logits(x, g);
console.log("ms per forward:", (Date.now() - t) / 2000);
