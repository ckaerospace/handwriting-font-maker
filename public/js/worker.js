// Web Worker: all image analysis and font building happens here, off the UI thread.
import { Classifier } from "./classifier.js";
import { Session } from "./session.js";
import * as opentype from "../vendor/opentype.min.mjs";

let session = null, ready = null;
async function init(base) {
  const [meta, buf, fb] = await Promise.all([
    fetch(base + "model/cls.json").then(r => r.json()),
    fetch(base + "model/cls.f16").then(r => r.arrayBuffer()),
    fetch(base + "model/fallback.json").then(r => r.json()).catch(() => null),
  ]);
  session = new Session({ cls: new Classifier(meta, buf), meta, fallback: fb, opentype });
}
const reply = (id, data, transfer = []) => postMessage({ id, ok: true, data }, transfer);
onmessage = async (e) => {
  const { id, cmd, args } = e.data;
  try {
    if (cmd === "init") { ready = init(args.base); await ready; return reply(id, true); }
    await ready;
    const S = session;
    switch (cmd) {
      case "prepare": { const r = S.prepare(new Uint8ClampedArray(args.rgba), args.w, args.h, args.opts); const pv = S.pageView(r.id); r.view = pv; return reply(id, r, [pv.gray.buffer]); }
      case "template": { const r = S.prepareTemplate(new Uint8ClampedArray(args.rgba), args.w, args.h, args.tpl, args.opts); return reply(id, r, [r.view.gray.buffer]); }
      case "label": { const v = S.label(args.photo, args.text, (p) => postMessage({ id, progress: p })); return reply(id, v); }
      case "views": return reply(id, S.views());
      case "relabel": S.relabel(args.sid, args.ch); return reply(id, S.views());
      case "remove": S.remove(args.sid, args.value); return reply(id, S.views());
      case "pin": S.pin(args.sid); return reply(id, S.views());
      case "split": S.split(args.sid, args.f); return reply(id, S.views());
      case "merge": S.merge(args.sid); return reply(id, S.views());
      case "reset": S.photos = []; return reply(id, S.views());
      case "build": { const r = await S.build(args.params, args.formats); const tr = [r.ttf, r.otf, r.woff].filter(Boolean).map(a => a.buffer); return reply(id, r, tr); }
      default: throw new Error("unknown command " + cmd);
    }
  } catch (err) { postMessage({ id, ok: false, error: String(err && err.message || err), stack: err && err.stack }); }
};
