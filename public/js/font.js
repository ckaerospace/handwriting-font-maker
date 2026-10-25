// Font assembly: layout (bearings, tracking, space), a TrueType (glyf) writer, OTF via vendored opentype.js, WOFF wrapper.
export const UPM = 1000;

const NAMES = { " ": "space", "!": "exclam", '"': "quotedbl", "#": "numbersign", "$": "dollar", "%": "percent", "&": "ampersand", "'": "quotesingle", "(": "parenleft", ")": "parenright", "*": "asterisk", "+": "plus", ",": "comma", "-": "hyphen", ".": "period", "/": "slash", ":": "colon", ";": "semicolon", "<": "less", "=": "equal", ">": "greater", "?": "question", "@": "at", "[": "bracketleft", "\\": "backslash", "]": "bracketright", "^": "asciicircum", "_": "underscore", "`": "grave", "{": "braceleft", "|": "bar", "}": "braceright", "~": "asciitilde", "\u00e4": "adieresis", "\u00f6": "odieresis", "\u00fc": "udieresis", "\u00c4": "Adieresis", "\u00d6": "Odieresis", "\u00dc": "Udieresis", "\u00df": "germandbls", "\u20ac": "Euro", "\u00e9": "eacute", "\u00e8": "egrave", "\u00e0": "agrave", "\u00e7": "ccedilla", "\u00f1": "ntilde", "\u2019": "quoteright", "\u2013": "endash", "\u00a7": "section" };
const DIG = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
export function glyphName(ch) {
  if (/[A-Za-z]/.test(ch)) return ch;
  if (/[0-9]/.test(ch)) return DIG[+ch];
  if (NAMES[ch]) return NAMES[ch];
  return "uni" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
}

/** Closed polygon of control points -> TrueType point list [x,y,on] (quadratic B-spline with explicit on-curve midpoints). */
export function splineToTT(pts) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    out.push([p[0], p[1], 0]);
    out.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 1]);
  }
  return out;
}

function bboxOf(contours) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const c of contours) for (const p of c) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return contours.length ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}

/**
 * Lay out glyph specs.
 * specs: [{ch, contours: TT point lists, cutL, cutR}] (any order); params: {sideBearing, tracking, spaceWidth, name}
 * Returns {glyphs:[{ch,cp,name,adv,lsb,contours(int, shifted so xmin=lsb),bbox}], notdef, space}
 */
export function layout(specs, params = {}) {
  const sb = params.sideBearing ?? 45, tr = params.tracking ?? 0, sw = params.spaceWidth ?? 300;
  const glyphs = [];
  for (const s of specs) {
    if (s.ch === " ") continue;
    const bb = bboxOf(s.contours);
    const lsb = s.cutL ? 0 : sb, rsb = s.cutR ? 0 : sb;
    const dx = lsb - bb[0];
    const contours = s.contours.map(c => c.map(p => [Math.round(p[0] + dx), Math.round(p[1]), p[2]]));
    const w = bb[2] - bb[0];
    const adv = Math.max(60, Math.round(lsb + w + rsb + tr));
    glyphs.push({ ch: s.ch, cp: s.ch.codePointAt(0), name: glyphName(s.ch), adv, lsb: Math.round(lsb), contours, bbox: bboxOf(contours) });
  }
  glyphs.sort((a, b) => a.cp - b.cp);
  const notdef = (() => {
    // box with a hole: outer clockwise, inner counter-clockwise (TrueType)
    const o = [[50, 0, 1], [50, 700, 1], [450, 700, 1], [450, 0, 1]], i = [[100, 50, 1], [400, 50, 1], [400, 650, 1], [100, 650, 1]];
    return { ch: null, cp: -1, name: ".notdef", adv: 500, lsb: 50, contours: [o, i], bbox: [50, 0, 450, 700] };
  })();
  const space = { ch: " ", cp: 32, name: "space", adv: Math.round(sw), lsb: 0, contours: [], bbox: [0, 0, 0, 0] };
  return { glyphs: [notdef, space, ...glyphs], params };
}

// ---------- binary helpers ----------
class W {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); return this; }
  i8(v) { return this.u8(v); }
  u16(v) { this.a.push((v >> 8) & 255, v & 255); return this; }
  i16(v) { return this.u16(v & 0xffff); }
  u32(v) { this.a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return this; }
  i32(v) { return this.u32(v >>> 0); }
  tag(s) { for (let i = 0; i < 4; i++) this.a.push(s.charCodeAt(i)); return this; }
  bytes(b) { for (const x of b) this.a.push(x); return this; }
  pad4() { while (this.a.length % 4) this.a.push(0); return this; }
  get length() { return this.a.length; }
  arr() { return Uint8Array.from(this.a); }
}
function checksum(b) {
  let s = 0; const n = Math.ceil(b.length / 4) * 4;
  for (let i = 0; i < n; i += 4) s = (s + (((b[i] || 0) << 24) | ((b[i + 1] || 0) << 16) | ((b[i + 2] || 0) << 8) | (b[i + 3] || 0))) >>> 0;
  return s >>> 0;
}
const utf16 = s => { const w = new W(); for (const c of s) { const cp = c.codePointAt(0); if (cp > 0xffff) { const v = cp - 0x10000; w.u16(0xd800 + (v >> 10)).u16(0xdc00 + (v & 0x3ff)); } else w.u16(cp); } return w.arr(); };
const ascii = s => Uint8Array.from(Array.from(s).map(c => c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 63));

export function psName(name) { const s = name.normalize("NFKD").replace(/[^A-Za-z0-9]/g, ""); return (s || "MyHandwriting").slice(0, 40); }

function glyfData(g) {
  const w = new W(); const cs = g.contours;
  if (!cs.length) return new Uint8Array(0);
  const bb = bboxOf(cs);
  w.i16(cs.length).i16(bb[0]).i16(bb[1]).i16(bb[2]).i16(bb[3]);
  let n = 0; for (const c of cs) { n += c.length; w.u16(n - 1); }
  w.u16(0); // instruction length
  const flags = [], xs = [], ys = [];
  let px = 0, py = 0;
  for (const c of cs) for (const p of c) {
    const dx = p[0] - px, dy = p[1] - py; px = p[0]; py = p[1];
    let f = p[2] ? 1 : 0;
    if (dx === 0) f |= 0x10; else if (Math.abs(dx) < 256) { f |= 0x02; if (dx > 0) f |= 0x10; xs.push(Math.abs(dx), 1); } else xs.push(dx, 2);
    if (dy === 0) f |= 0x20; else if (Math.abs(dy) < 256) { f |= 0x04; if (dy > 0) f |= 0x20; ys.push(Math.abs(dy), 1); } else ys.push(dy, 2);
    flags.push(f);
  }
  for (const f of flags) w.u8(f);
  for (let i = 0; i < xs.length; i += 2) xs[i + 1] === 1 ? w.u8(xs[i]) : w.i16(xs[i]);
  for (let i = 0; i < ys.length; i += 2) ys[i + 1] === 1 ? w.u8(ys[i]) : w.i16(ys[i]);
  w.pad4();
  return w.arr();
}

function cmapTable(glyphs) {
  const map = glyphs.map((g, i) => [g.cp, i]).filter(([cp]) => cp >= 0 && cp <= 0xffff).sort((a, b) => a[0] - b[0]);
  const segs = [];
  for (const [cp, gid] of map) {
    const l = segs[segs.length - 1];
    if (l && cp === l.end + 1 && gid - cp === l.delta) l.end = cp; else segs.push({ start: cp, end: cp, delta: gid - cp });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const sc = segs.length, len = 16 + sc * 8;
  const sub = new W();
  let es = 1, log = 0; while (es * 2 <= sc) { es *= 2; log++; }
  sub.u16(4).u16(len).u16(0).u16(sc * 2).u16(es * 2).u16(log).u16(sc * 2 - es * 2);
  for (const s of segs) sub.u16(s.end);
  sub.u16(0);
  for (const s of segs) sub.u16(s.start);
  for (const s of segs) sub.u16(s.delta & 0xffff);
  for (let i = 0; i < sc; i++) sub.u16(0);
  const w = new W(); w.u16(0).u16(2);
  w.u16(0).u16(3).u32(20); w.u16(3).u16(1).u32(20);
  w.bytes(sub.arr());
  return w.arr();
}

function nameTable(meta) {
  const family = meta.name, ps = psName(meta.name);
  const recs = [[0, meta.copyright || ""], [1, family], [2, "Regular"], [3, `${ps}:${meta.stamp || "1"}`], [4, family], [5, "Version 1.000"], [6, ps], [13, meta.license || "Created with Handwriting Font Maker from the user's own handwriting."]];
  const all = [];
  for (const [id, s] of recs) { all.push({ p: 3, e: 1, l: 0x409, id, b: utf16(s) }); all.push({ p: 1, e: 0, l: 0, id, b: ascii(s) }); }
  all.sort((a, b) => a.p - b.p || a.e - b.e || a.l - b.l || a.id - b.id);
  const w = new W(); w.u16(0).u16(all.length).u16(6 + all.length * 12);
  let off = 0; for (const r of all) { w.u16(r.p).u16(r.e).u16(r.l).u16(r.id).u16(r.b.length).u16(off); off += r.b.length; }
  for (const r of all) w.bytes(r.b);
  return w.arr();
}

export function metricsOf(model, meta = {}) {
  let asc = meta.ascender ?? 900, desc = meta.descender ?? -300;
  let yMax = 0, yMin = 0;
  for (const g of model.glyphs) { if (g.bbox[3] > yMax) yMax = g.bbox[3]; if (g.bbox[1] < yMin) yMin = g.bbox[1]; }
  return { asc, desc, winAsc: Math.max(asc, yMax + 20), winDesc: Math.max(-desc, -yMin + 20), yMax, yMin };
}

export function buildTTF(model, meta) {
  const G = model.glyphs, n = G.length, M = metricsOf(model, meta);
  const gd = G.map(glyfData);
  const glyf = new W(), loca = new W();
  for (const d of gd) { loca.u32(glyf.length); glyf.bytes(d); }
  loca.u32(glyf.length);
  let xMin = 1e9, yMin = 1e9, xMax = -1e9, yMax = -1e9, maxPts = 0, maxCont = 0, advMax = 0, minLsb = 1e9, minRsb = 1e9, maxExt = -1e9;
  const hmtx = new W();
  for (const g of G) {
    hmtx.u16(g.adv).i16(g.contours.length ? g.bbox[0] : 0);
    if (g.contours.length) {
      xMin = Math.min(xMin, g.bbox[0]); yMin = Math.min(yMin, g.bbox[1]); xMax = Math.max(xMax, g.bbox[2]); yMax = Math.max(yMax, g.bbox[3]);
      maxPts = Math.max(maxPts, g.contours.reduce((a, c) => a + c.length, 0)); maxCont = Math.max(maxCont, g.contours.length);
      minLsb = Math.min(minLsb, g.bbox[0]); minRsb = Math.min(minRsb, g.adv - g.bbox[2]); maxExt = Math.max(maxExt, g.bbox[2]);
    }
    advMax = Math.max(advMax, g.adv);
  }
  if (xMin > xMax) { xMin = yMin = xMax = yMax = 0; minLsb = minRsb = maxExt = 0; }
  const secs = {};
  const sec = new Date(), mac = Math.floor(sec.getTime() / 1000) + 2082844800;
  secs["head"] = new W().u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(3).u16(UPM).u32(0).u32(mac).u32(0).u32(mac).i16(xMin).i16(yMin).i16(xMax).i16(yMax).u16(0).u16(8).i16(2).i16(1).i16(0).arr();
  secs["hhea"] = new W().u32(0x00010000).i16(M.asc).i16(M.desc).i16(0).u16(advMax).i16(minLsb).i16(minRsb).i16(maxExt).i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(n).arr();
  secs["maxp"] = new W().u32(0x00010000).u16(n).u16(maxPts).u16(maxCont).u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).arr();
  const cps = G.filter(g => g.cp >= 0).map(g => g.cp);
  const has = (a, b) => cps.some(c => c >= a && c <= b);
  let ur1 = 0, ur2 = 0, ur3 = 0;
  if (has(0x20, 0x7e)) ur1 |= 1; if (has(0xa0, 0xff)) ur1 |= 2;
  if (has(0x2000, 0x206f)) ur1 |= 0x80000000; // bit 31: general punctuation
  if (has(0x20a0, 0x20cf)) ur2 |= 2; // bit 33: currency symbols
  const avg = Math.round(G.filter(g => g.cp > 32).reduce((a, g) => a + g.adv, 0) / Math.max(1, G.filter(g => g.cp > 32).length));
  const glyphFor = ch => G.find(g => g.cp === ch.codePointAt(0));
  const xh = glyphFor("x") ? glyphFor("x").bbox[3] : 500, cap = glyphFor("H") ? glyphFor("H").bbox[3] : 700;
  secs["OS/2"] = new W().u16(4).i16(avg).u16(400).u16(5).u16(0)
    .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(50).i16(300).i16(0)
    .bytes(new Array(10).fill(0)).u32(ur1 >>> 0).u32(ur2 >>> 0).u32(0).u32(0).tag("HWFM")
    .u16(0xc0).u16(Math.min(...cps.filter(c => c > 0))).u16(Math.min(0xffff, Math.max(...cps)))
    .i16(M.asc).i16(M.desc).i16(0).u16(M.winAsc).u16(M.winDesc).u32(1).u32(0)
    .i16(xh).i16(cap).u16(0).u16(32).u16(1).arr();
  secs["cmap"] = cmapTable(G);
  secs["glyf"] = glyf.arr(); secs["loca"] = loca.arr(); secs["hmtx"] = hmtx.arr();
  secs["name"] = nameTable(meta);
  secs["post"] = new W().u32(0x00030000).u32(0).i16(-100).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0).arr();
  secs["gasp"] = new W().u16(1).u16(1).u16(0xffff).u16(0x000f).arr();
  return assemble(secs);
}

function assemble(secs) {
  const tags = Object.keys(secs).sort();
  const nt = tags.length; let es = 1, log = 0; while (es * 2 <= nt) { es *= 2; log++; }
  const hdr = new W(); hdr.u32(0x00010000).u16(nt).u16(es * 16).u16(log).u16(nt * 16 - es * 16);
  let off = 12 + nt * 16; const body = new W(); const recs = [];
  for (const t of tags) {
    const d = secs[t]; recs.push({ t, off, len: d.length, cs: checksum(d) });
    body.bytes(d); body.pad4(); off = 12 + nt * 16 + body.length;
  }
  for (const r of recs) hdr.tag(r.t).u32(r.cs).u32(r.off).u32(r.len);
  const out = new Uint8Array(12 + nt * 16 + body.length); out.set(hdr.arr(), 0); out.set(body.arr(), 12 + nt * 16);
  const total = checksum(out), adj = (0xb1b0afba - total) >>> 0;
  const head = recs.find(r => r.t === "head");
  const dv = new DataView(out.buffer); dv.setUint32(head.off + 8, adj);
  // fix head checksum in the directory (computed with adjustment 0)
  return out;
}

/** OTF (CFF) through the vendored opentype.js. `opentype` is the imported module namespace. */
export function buildOTF(model, meta, opentype) {
  const M = metricsOf(model, meta);
  const mk = (g) => {
    const p = new opentype.Path();
    for (const c0 of g.contours) {
      const c = c0.slice().reverse(); // CFF: outer contours counter-clockwise
      const n = c.length;
      // rotate to start at an on-curve point
      let s = c.findIndex(q => q[2]); if (s < 0) s = 0;
      const pt = i => c[(s + i) % n];
      p.moveTo(pt(0)[0], pt(0)[1]);
      let i = 1;
      while (i <= n) {
        const a = pt(i % n);
        if (a[2]) { if (i < n) p.lineTo(a[0], a[1]); i++; }
        else {
          const b = pt((i + 1) % n);
          if (b[2]) { p.quadraticCurveTo(a[0], a[1], b[0], b[1]); i += 2; }
          else { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; p.quadraticCurveTo(a[0], a[1], mx, my); i++; }
        }
      }
      p.close();
    }
    return new opentype.Glyph({ name: g.name, unicode: g.cp >= 0 ? g.cp : undefined, advanceWidth: g.adv, path: p });
  };
  const glyphs = model.glyphs.map(mk);
  const font = new opentype.Font({ familyName: meta.name, styleName: "Regular", unitsPerEm: UPM, ascender: M.asc, descender: M.desc, glyphs });
  const o = font.names.windows || font.names;
  try { font.names.unicode = font.names.unicode || {}; } catch (e) {}
  return font.toArrayBuffer();
}

/** WOFF 1.0 wrapper (zlib per table via CompressionStream). */
export async function buildWOFF(ttf) {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const nt = dv.getUint16(4), recs = [];
  for (let i = 0; i < nt; i++) { const o = 12 + i * 16; recs.push({ tag: String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)), cs: dv.getUint32(o + 4), off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) }); }
  const z = async (b) => {
    const cs = new CompressionStream("deflate"); const w = cs.writable.getWriter(); w.write(b); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  };
  const tabs = [];
  for (const r of recs) { const raw = ttf.subarray(r.off, r.off + r.len); const c = await z(raw); tabs.push({ r, data: c.length < raw.length ? c : raw, comp: c.length < raw.length }); }
  let off = 44 + nt * 20; const body = new W(); const dir = new W();
  for (const t of tabs) { dir.tag(t.r.tag).u32(off + body.length).u32(t.data.length).u32(t.r.len).u32(t.r.cs); body.bytes(t.data); body.pad4(); }
  const total = 44 + nt * 20 + body.length;
  const sfnt = 12 + nt * 16 + recs.reduce((a, r) => a + Math.ceil(r.len / 4) * 4, 0);
  const h = new W(); h.tag("wOFF").u32(0x00010000).u32(total).u16(nt).u16(0).u32(sfnt).u16(1).u16(0).u32(0).u32(0).u32(0).u32(0).u32(0);
  const out = new Uint8Array(total); out.set(h.arr(), 0); out.set(dir.arr(), 44); out.set(body.arr(), 44 + nt * 20);
  return out;
}
