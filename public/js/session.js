// Stateful session (photos, glyph samples, edits, font build). DOM free: used by the Web Worker and by Node tests.
import { preparePhoto, labelWithTranscript, chooseBest, missingChars, buildModel, measureSpace, suggestText, ALL_CHARS } from "./pipeline.js";
import { extractSample, samplesFromAlignment, fillConfidence, judge } from "./glyphs.js";
import { recognize } from "./recognize.js";
import { chooseWordThreshold, labelComponents } from "./segment.js";
import { buildTTF, buildOTF, buildWOFF } from "./font.js";

export class Session {
  constructor({ cls, meta, fallback = null, opentype = null }) {
    this.cls = cls; this.meta = meta; this.fallback = fallback; this.opentype = opentype;
    this.photos = []; this.nextSid = 1;
  }

  prepare(rgba, w, h, opts = {}) {
    const prep = preparePhoto(rgba, w, h, opts);
    const id = this.photos.length;
    this.photos.push({ id, prep, samples: [], mode: null, cost: null });
    const { pg, seg } = prep;
    return { id, w: pg.w, h: pg.h, lines: seg.lines.map(L => ({ y0: L.y0, y1: L.y1, xh: L.xh, x0: L.x0, x1: L.x1 })), usedQuad: pg.usedQuad, skew: pg.skew, inkFrac: pg.inkFrac, contrast: pg.contrast };
  }

  /** Template ("best quality") photo: cells are located from the page quad, then each cell holds one character. */
  prepareTemplate(rgba, w, h, tpl, opts = {}) {
    const prep = preparePhoto(rgba, w, h, { ...opts, noSegment: true, skew: false });
    const { pg } = prep;
    const { labels, atoms } = labelComponents(pg.d, pg.w, pg.h, 0.5);
    const [gx0, gy0, gx1, gy1] = tpl.grid, cw = (gx1 - gx0) * pg.w / tpl.cols, ch = (gy1 - gy0) * pg.h / tpl.rows;
    const lines = []; const cells = [];
    for (let k = 0; k < tpl.chars.length; k++) {
      const r = Math.floor(k / tpl.cols), c = k % tpl.cols;
      const x0 = gx0 * pg.w + c * cw, y0 = gy0 * pg.h + r * ch;
      cells.push({ x0, y0 });
      lines.push({ atoms: [], xh: tpl.xh * ch, base0: y0 + tpl.base * ch, slope: 0, gaps: [], words: [], x0, x1: x0 + cw, y0, y1: y0 + ch });
    }
    const lz = tpl.label, minArea = Math.max(6, 0.00004 * cw * ch);
    for (let i = 1; i < atoms.length; i++) {
      const a = atoms[i];
      if (a.area < minArea || a.x1 - a.x0 > 1.15 * cw || a.y1 - a.y0 > 1.15 * ch) continue;
      const c = Math.floor((a.cx - gx0 * pg.w) / cw), r = Math.floor((a.cy - gy0 * pg.h) / ch);
      if (c < 0 || c >= tpl.cols || r < 0 || r >= tpl.rows) continue;
      const k = r * tpl.cols + c; if (k >= tpl.chars.length) continue;
      const fx = (a.x1 - (gx0 * pg.w + c * cw)) / cw, fy = (a.y1 - (gy0 * pg.h + r * ch)) / ch;
      if (fx < lz[2] + 0.04 && fy < lz[3] + 0.04) continue; // printed label zone
      lines[k].atoms.push(i);
    }
    const seg = { labels, atoms, w: pg.w, h: pg.h, lines };
    const id = this.photos.length;
    const samples = [];
    for (let k = 0; k < lines.length; k++) {
      if (!lines[k].atoms.length) continue;
      const s = extractSample(seg, pg.d, k, Math.round(cells[k].x0 - 0.08 * cw), Math.round(cells[k].x0 + 1.08 * cw));
      if (!s || s.inkPx < minArea) continue;
      s.ch = tpl.chars[k]; s.cutL = s.cutR = false; s.edgeL = s.edgeR = false; s.sid = this.nextSid++; s.photo = id;
      fillConfidence(s, this.cls); samples.push(s);
    }
    this.photos.push({ id, prep: { pg, seg }, samples, mode: "template", cost: null });
    return { id, w: pg.w, h: pg.h, lines: [], usedQuad: pg.usedQuad, filled: samples.length, cells: lines.length, view: this.pageView(id) };
  }

  /** Grey preview of the flattened page (0 = ink). */
  pageView(id, maxLong = 1100) {
    const { pg } = this.photos[id].prep;
    const k = Math.min(1, maxLong / Math.max(pg.w, pg.h)), w = Math.round(pg.w * k), h = Math.round(pg.h * k);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // box average of d over the source cell (cheap two-sample max to keep thin strokes)
      const sx = Math.min(pg.w - 1, Math.floor(x / k)), sy = Math.min(pg.h - 1, Math.floor(y / k));
      const sx2 = Math.min(pg.w - 1, Math.floor((x + 0.5) / k)), sy2 = Math.min(pg.h - 1, Math.floor((y + 0.5) / k));
      const v = Math.max(pg.d[sy * pg.w + sx], pg.d[sy2 * pg.w + sx2]);
      out[y * w + x] = 255 - Math.round(255 * Math.min(1, v));
    }
    return { w, h, k, gray: out };
  }

  label(id, text, onProgress) {
    const ph = this.photos[id], { seg, pg } = ph.prep;
    let samples;
    if (text && text.trim()) {
      const r = labelWithTranscript(ph.prep, text, this.meta, this.cls);
      samples = r.samples; ph.cost = r.cost; ph.mode = "transcript";
    } else {
      const nw = 0;
      const thr = 0.45;
      const al = recognize(seg, pg.d, this.cls, this.meta, { g0: thr, onProgress });
      samples = samplesFromAlignment(seg, pg.d, al, this.cls); ph.mode = "auto"; ph.cost = al.res.cost;
    }
    for (const s of samples) { s.sid = this.nextSid++; s.photo = id; }
    ph.samples = samples;
    return this.views();
  }

  find(sid) { for (const ph of this.photos) { const i = ph.samples.findIndex(s => s.sid === sid); if (i >= 0) return { ph, i, s: ph.samples[i] }; } return null; }

  relabel(sid, ch) {
    const f = this.find(sid); if (!f) return;
    f.s.ch = ch; f.s.manual = true; f.s.deleted = false; fillConfidence(f.s, this.cls);
  }
  remove(sid, v = true) { const f = this.find(sid); if (f) f.s.deleted = v; }
  pin(sid) {
    const f = this.find(sid); if (!f || !f.s.ch) return;
    for (const ph of this.photos) for (const s of ph.samples) if (s.ch === f.s.ch) s.pinned = false;
    f.s.pinned = true; f.s.deleted = false;
  }
  _fresh(ph, line, xs, xe, ch, cutL, cutR, old) {
    const n = extractSample(ph.prep.seg, ph.prep.pg.d, line, xs, xe);
    if (!n) return null;
    n.sid = this.nextSid++; n.photo = ph.id; n.ch = ch; n.cutL = cutL; n.cutR = cutR; n.edgeL = old.edgeL; n.edgeR = old.edgeR;
    n.manual = !!ch && old.manual; n.pinned = old.pinned && !!ch;
    if (ch) fillConfidence(n, this.cls); else { n.p = null; n.top = null; n.pTop = null; }
    return n;
  }
  /** Split at fraction f (0..1) of the span width. */
  split(sid, f = 0.5) {
    const r = this.find(sid); if (!r) return;
    const { ph, i, s } = r, xm = Math.round(s.xs + (s.xe - s.xs) * f);
    if (xm - s.xs < 3 || s.xe - xm < 3) return;
    const a = this._fresh(ph, s.line, s.xs, xm, s.ch, s.cutL, true, s), b = this._fresh(ph, s.line, xm, s.xe, "", true, s.cutR, s);
    if (!a && !b) return;
    ph.samples.splice(i, 1, ...[a, b].filter(Boolean));
  }
  /** Merge with the next sample on the same line. */
  merge(sid) {
    const r = this.find(sid); if (!r) return;
    const { ph, i, s } = r, nx = ph.samples[i + 1];
    if (!nx || nx.line !== s.line) return;
    const m = this._fresh(ph, s.line, s.xs, nx.xe, s.ch || nx.ch, s.cutL, nx.cutR, s);
    if (m) ph.samples.splice(i, 2, m);
  }

  allSamples() { return this.photos.flatMap(p => p.samples); }
  best() { return chooseBest(this.allSamples(), this.meta); }

  views() {
    const best = this.best();
    const out = [];
    for (const ph of this.photos) for (const s of ph.samples) {
      const j = s.manual ? { conf: 1, flag: false, reason: "" } : judge(s, ph.mode === "auto");
      const used = !!s.ch && best.get(s.ch) === s;
      const alpha = new Uint8Array(s.w * s.h); for (let k = 0; k < alpha.length; k++) alpha[k] = Math.round(255 * Math.min(1, s.d[k]));
      out.push({
        sid: s.sid, photo: s.photo, line: s.line, ch: s.ch || "", conf: j.conf, flag: !s.ch || j.flag, reason: s.ch ? j.reason : "no label",
        top: s.top, cutL: !!s.cutL, cutR: !!s.cutR, deleted: !!s.deleted, manual: !!s.manual, used, pinned: !!s.pinned,
        x0: s.x0, y0: s.y0, w: s.w, h: s.h, base: s.base - s.y0, xh: s.xh, xs: s.xs, xe: s.xe, alpha,
      });
    }
    const missing = missingChars(best);
    return { glyphs: out, missing, suggestions: suggestText(missing), covered: best.size, total: ALL_CHARS.length, autoSpace: measureSpace(this.photos.map(p => p.prep)), cutFrac: this._cutFrac() };
  }
  _cutFrac() { const all = this.allSamples().filter(s => s.ch && !s.deleted); if (!all.length) return 0; return all.filter(s => s.cutL || s.cutR).length / all.length; }

  async build(params, formats = ["ttf", "otf", "woff"]) {
    const best = this.best();
    const p = { sideBearing: 45, tracking: 0, smooth: 0.6, thickness: 0, ...params };
    if (p.spaceWidth == null) p.spaceWidth = measureSpace(this.photos.map(x => x.prep));
    if (p.joinCursive == null) p.joinCursive = this._cutFrac() > 0.3;
    const model = buildModel(best, p, p.fallback ? this.fallback : null);
    const name = (p.name || "My Handwriting").trim() || "My Handwriting";
    const meta = { name, stamp: p.stamp };
    const out = { missing: missingChars(best), glyphCount: model.glyphs.length, params: { ...p, fallback: !!p.fallback } };
    if (formats.includes("ttf") || formats.includes("woff")) out.ttf = buildTTF(model, meta);
    if (formats.includes("otf") && this.opentype) out.otf = new Uint8Array(buildOTF(model, meta, this.opentype));
    if (formats.includes("woff")) out.woff = await buildWOFF(out.ttf);
    return out;
  }
}
