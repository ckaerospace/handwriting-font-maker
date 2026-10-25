// Tiny on-device character classifier (CNN 24x24 + 5 geometry features). Weights are float16, lazy-loaded.
export class Classifier {
  constructor(meta, buf) {
    this.meta = meta; this.chars = Array.from(meta.chars); this.ncls = meta.ncls; this.JUNK = meta.ncls - 1;
    const u16 = new Uint16Array(buf);
    const f = new Float32Array(u16.length);
    for (let i = 0; i < u16.length; i++) f[i] = f16(u16[i]);
    let o = 0; const L = {};
    for (const k of Object.keys(meta.layers)) { const n = meta.layers[k].reduce((a, b) => a * b, 1); L[k] = f.subarray(o, o + n); o += n; }
    this.L = L;
    this.c1 = new Float32Array(24 * 24 * 12); this.p1 = new Float32Array(12 * 12 * 12); this.c2 = new Float32Array(12 * 12 * 24); this.feat = new Float32Array(869); this.h = new Float32Array(128);
    this.wprior = meta.wprior;
  }
  static async load(base = "model/") {
    const [meta, buf] = await Promise.all([fetch(base + "cls.json").then(r => r.json()), fetch(base + "cls.f16").then(r => r.arrayBuffer())]);
    return new Classifier(meta, buf);
  }
  /** x: Float32Array(576) ink in 0..1, g: 5 geometry features. Returns Float32Array(ncls) logits. */
  logits(x, g, out) {
    const L = this.L, c1 = this.c1, p1 = this.p1, c2 = this.c2, feat = this.feat, h = this.h;
    out = out || new Float32Array(this.ncls);
    // conv1 1->12, 24x24, relu, pool -> 12x12
    const w1 = L["c1.weight"], b1 = L["c1.bias"];
    for (let oc = 0; oc < 12; oc++) {
      const wb = oc * 9, bias = b1[oc];
      for (let y = 0; y < 24; y++) for (let xx = 0; xx < 24; xx++) {
        let s = bias;
        for (let ky = 0; ky < 3; ky++) { const yy = y + ky - 1; if (yy < 0 || yy > 23) continue; for (let kx = 0; kx < 3; kx++) { const x2 = xx + kx - 1; if (x2 < 0 || x2 > 23) continue; s += x[yy * 24 + x2] * w1[wb + ky * 3 + kx]; } }
        c1[(oc * 24 + y) * 24 + xx] = s > 0 ? s : 0;
      }
      for (let y = 0; y < 12; y++) for (let xx = 0; xx < 12; xx++) {
        const i = (oc * 24 + 2 * y) * 24 + 2 * xx;
        p1[(oc * 12 + y) * 12 + xx] = Math.max(c1[i], c1[i + 1], c1[i + 24], c1[i + 25]);
      }
    }
    // conv2 12->24 on 12x12, relu, pool -> 6x6
    const w2 = L["c2.weight"], b2 = L["c2.bias"];
    for (let oc = 0; oc < 24; oc++) {
      const bias = b2[oc];
      for (let y = 0; y < 12; y++) for (let xx = 0; xx < 12; xx++) {
        let s = bias;
        for (let ic = 0; ic < 12; ic++) {
          const wb = (oc * 12 + ic) * 9, pb = ic * 144;
          for (let ky = 0; ky < 3; ky++) { const yy = y + ky - 1; if (yy < 0 || yy > 11) continue; for (let kx = 0; kx < 3; kx++) { const x2 = xx + kx - 1; if (x2 < 0 || x2 > 11) continue; s += p1[pb + yy * 12 + x2] * w2[wb + ky * 3 + kx]; } }
        }
        c2[(oc * 12 + y) * 12 + xx] = s > 0 ? s : 0;
      }
      for (let y = 0; y < 6; y++) for (let xx = 0; xx < 6; xx++) {
        const i = (oc * 12 + 2 * y) * 12 + 2 * xx;
        feat[oc * 36 + y * 6 + xx] = Math.max(c2[i], c2[i + 1], c2[i + 12], c2[i + 13]);
      }
    }
    for (let i = 0; i < 5; i++) feat[864 + i] = g[i];
    const wf1 = L["f1.weight"], bf1 = L["f1.bias"];
    for (let o = 0; o < 128; o++) {
      let s = bf1[o]; const wb = o * 869;
      for (let i = 0; i < 869; i++) s += feat[i] * wf1[wb + i];
      h[o] = s > 0 ? s : 0;
    }
    const wf2 = L["f2.weight"], bf2 = L["f2.bias"];
    for (let o = 0; o < this.ncls; o++) {
      let s = bf2[o]; const wb = o * 128;
      for (let i = 0; i < 128; i++) s += h[i] * wf2[wb + i];
      out[o] = s;
    }
    return out;
  }
  /** log-softmax in place */
  static logSoftmax(l) {
    let m = -1e9; for (let i = 0; i < l.length; i++) if (l[i] > m) m = l[i];
    let s = 0; for (let i = 0; i < l.length; i++) s += Math.exp(l[i] - m);
    const ls = Math.log(s) + m; for (let i = 0; i < l.length; i++) l[i] -= ls; return l;
  }
}

function f16(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + m / 1024);
}

/**
 * Build the classifier input for a glyph pixel set.
 * d: soft ink field (w*h), region: {x0,x1,y0,y1} rows/cols (exclusive end), mask: optional Uint8 per-pixel keep mask (same size as d) or null.
 * base/xh: baseline row and x-height (px) for the geometry features. Returns {x:Float32Array(576), g:Float32Array(5), box} or null.
 */
export function glyphInput(d, w, region, base, xh, mask = null, labels = null, labelSet = null) {
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = region.y0; y < region.y1; y++) for (let x = region.x0; x < region.x1; x++) {
    const i = y * w + x;
    if (d[i] > 0.39 && (!labels || labelSet.has(labels[i]))) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x1++; y1++;
  const bw = x1 - x0, bh = y1 - y0;
  if (bw < 2 || bh < 2) return null;
  const s = 22 / Math.max(bw, bh);
  const nw = Math.max(1, Math.round(bw * s)), nh = Math.max(1, Math.round(bh * s));
  const out = new Float32Array(576);
  const ox = (24 - nw) >> 1, oy = (24 - nh) >> 1;
  // area average resize
  for (let yy = 0; yy < nh; yy++) for (let xx = 0; xx < nw; xx++) {
    const sx0 = x0 + xx * bw / nw, sx1 = x0 + (xx + 1) * bw / nw, sy0 = y0 + yy * bh / nh, sy1 = y0 + (yy + 1) * bh / nh;
    let sum = 0, cnt = 0;
    for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
      const i = y * w + x; const keep = !labels || labelSet.has(labels[i]);
      const wy = Math.min(y + 1, sy1) - Math.max(y, sy0), wx = Math.min(x + 1, sx1) - Math.max(x, sx0);
      const wt = wx * wy; if (wt <= 0) continue;
      sum += (keep ? d[i] : 0) * wt; cnt += wt;
    }
    out[(oy + yy) * 24 + ox + xx] = cnt ? sum / cnt : 0;
  }
  const g = new Float32Array([
    Math.min(bw / xh, 4) / 2, Math.min(bh / xh, 4) / 2,
    Math.max(-1, Math.min(3.5, (base - y0) / xh)) / 2, Math.max(-1.5, Math.min(3, (base - y1) / xh)) / 2,
    Math.min(bw / bh, 6) / 3]);
  return { x: out, g, box: { x0, x1, y0, y1 } };
}
