import fs from "fs";
import { Classifier } from "../../public/js/classifier.js";
import { Session } from "../../public/js/session.js";
import * as opentype from "../../public/vendor/opentype.min.mjs";
export function makeSession() {
  const meta = JSON.parse(fs.readFileSync("public/model/cls.json")); const buf = fs.readFileSync("public/model/cls.f16");
  const cls = new Classifier(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const fallback = JSON.parse(fs.readFileSync("public/model/fallback.json"));
  return new Session({ cls, meta, fallback, opentype });
}
