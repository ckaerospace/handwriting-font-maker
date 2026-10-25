// Vectorise a soft ink field: upsample, blur, marching squares at an iso level, simplify, orient.
// Output contours are closed polylines; font.js turns them into quadratic B-spline outlines.

/** Bilinear upsample of a (w*h) field by integer factor u, with a 1-pixel zero border handled by the caller. */
export function upsample(d, w, h, u) {
  const W = w * u, H = h * u, out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / u - 0.5, y0 = Math.max(0, Math.min(h - 1, Math.floor(fy))), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / u - 0.5, x0 = Math.max(0, Math.min(w - 1, Math.floor(fx))), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, Math.min(1, fx - x0));
      out[y * W + x] = (d[y0 * w + x0] * (1 - tx) + d[y0 * w + x1] * tx) * (1 - ty) + (d[y1 * w + x0] * (1 - tx) + d[y1 * w + x1] * tx) * ty;
    }
  }
  return { data: out, w: W, h: H };
}

export function blur(d, w, h, sigma) {
  if (sigma < 0.3) return d;
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) { const xx = x + i; if (xx >= 0 && xx < w) a += d[y * w + xx] * k[i + r]; } t[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) { const yy = y + i; if (yy >= 0 && yy < h) a += t[yy * w + x] * k[i + r]; } o[y * w + x] = a; }
  return o;
}

/** Marching squares. Field must have a zero border. Returns closed contours as arrays of [x,y] in pixel-centre coordinates. */
export function marching(f, w, h, iso) {
  const adj = new Map(); // edge id -> [neighbour ids]
  const pos = new Map();
  const eid = (horiz, x, y) => (y * w + x) * 2 + (horiz ? 0 : 1);
  const point = (id) => {
    let p = pos.get(id); if (p) return p;
    const horiz = (id & 1) === 0, c = id >> 1, x = c % w, y = (c / w) | 0;
    if (horiz) { const a = f[y * w + x], b = f[y * w + x + 1], t = (iso - a) / (b - a); p = [x + t, y]; }
    else { const a = f[y * w + x], b = f[(y + 1) * w + x], t = (iso - a) / (b - a); p = [x, y + t]; }
    pos.set(id, p); return p;
  };
  const link = (a, b) => { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const tl = f[y * w + x] >= iso, tr = f[y * w + x + 1] >= iso, br = f[(y + 1) * w + x + 1] >= iso, bl = f[(y + 1) * w + x] >= iso;
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const T = eid(true, x, y), B = eid(true, x, y + 1), L = eid(false, x, y), R = eid(false, x + 1, y);
    switch (c) {
      case 1: case 14: link(L, B); break;
      case 2: case 13: link(B, R); break;
      case 3: case 12: link(L, R); break;
      case 4: case 11: link(T, R); break;
      case 6: case 9: link(T, B); break;
      case 7: case 8: link(T, L); break;
      case 5: case 10: {
        const mid = (f[y * w + x] + f[y * w + x + 1] + f[(y + 1) * w + x + 1] + f[(y + 1) * w + x]) / 4 >= iso;
        if ((c === 5) === mid) { link(T, L); link(B, R); } else { link(T, R); link(L, B); }
        break;
      }
    }
  }
  const seen = new Set(), out = [];
  for (const [start] of adj) {
    if (seen.has(start)) continue;
    const loop = []; let prev = -1, cur = start;
    while (!seen.has(cur)) {
      seen.add(cur); loop.push(point(cur));
      const nb = adj.get(cur); let nx = nb[0] === prev ? nb[1] : nb[0];
      if (nb.length === 2 && nb[0] === nb[1]) nx = nb[0];
      prev = cur; cur = nx; if (cur === undefined) break;
    }
    if (loop.length >= 4) out.push(loop);
  }
  return out;
}

export function area(poly) { let a = 0; for (let i = 0, n = poly.length; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

function dpOpen(pts, i0, i1, eps2, keep) {
  let md = -1, mi = -1; const a = pts[i0], b = pts[i1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  for (let i = i0 + 1; i < i1; i++) {
    const p = pts[i]; let d2;
    if (L2 === 0) d2 = (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2; else { const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)); d2 = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2; }
    if (d2 > md) { md = d2; mi = i; }
  }
  if (md > eps2) { keep[mi] = 1; dpOpen(pts, i0, mi, eps2, keep); dpOpen(pts, mi, i1, eps2, keep); }
}
/** Douglas-Peucker for a closed polygon. */
export function simplifyClosed(poly, eps) {
  const n = poly.length; if (n < 6) return poly;
  let a = 0, b = 0, md = -1;
  for (let i = 1; i < n; i++) { const d = (poly[i][0] - poly[0][0]) ** 2 + (poly[i][1] - poly[0][1]) ** 2; if (d > md) { md = d; b = i; } }
  const keep = new Uint8Array(n + 1); keep[a] = 1; keep[b] = 1;
  const seq1 = poly.slice(0, b + 1), seq2 = poly.slice(b).concat([poly[0]]);
  const k1 = new Uint8Array(seq1.length); k1[0] = k1[seq1.length - 1] = 1; dpOpen(seq1, 0, seq1.length - 1, eps * eps, k1);
  const k2 = new Uint8Array(seq2.length); k2[0] = k2[seq2.length - 1] = 1; dpOpen(seq2, 0, seq2.length - 1, eps * eps, k2);
  const out = [];
  for (let i = 0; i < seq1.length; i++) if (k1[i]) out.push(seq1[i]);
  for (let i = 1; i < seq2.length - 1; i++) if (k2[i]) out.push(seq2[i]);
  return out;
}

function pip(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Trace one glyph field.
 * opts: up (upsample), sigma (blur in source px), iso (0..1), eps (simplify tol in source px), minArea (source px^2).
 * Returns [{pts:[[x,y]...] in source pixel coordinates (centre of pixel (0,0) = (0,0)), hole:boolean}]
 */
export function traceField(d, w, h, opts = {}) {
  const up = opts.up ?? 3, sigma = opts.sigma ?? 0.6, iso = opts.iso ?? 0.5, eps = opts.eps ?? 0.16, minArea = opts.minArea ?? 2.5;
  const pad = 2;
  const pw = w + 2 * pad, ph = h + 2 * pad, p = new Float32Array(pw * ph);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[(y + pad) * pw + x + pad] = d[y * w + x];
  const U = upsample(p, pw, ph, up);
  const B = blur(U.data, U.w, U.h, sigma * up);
  // keep a zero border for the contour tracer
  for (let x = 0; x < U.w; x++) { B[x] = 0; B[(U.h - 1) * U.w + x] = 0; }
  for (let y = 0; y < U.h; y++) { B[y * U.w] = 0; B[y * U.w + U.w - 1] = 0; }
  const loops = marching(B, U.w, U.h, iso);
  const conv = ([x, y]) => [(x + 0.5) / up - 0.5 - pad, (y + 0.5) / up - 0.5 - pad];
  const polys = [];
  for (const lp of loops) {
    const q = lp.map(conv);
    if (Math.abs(area(q)) < minArea) continue;
    const s = simplifyClosed(q, eps);
    if (s.length >= 3 && Math.abs(area(s)) >= minArea) polys.push(s);
  }
  // hole = contained in an odd number of other contours
  return polys.map((poly, i) => {
    let depth = 0;
    for (let j = 0; j < polys.length; j++) if (j !== i && pip(poly[0], polys[j])) depth++;
    return { pts: poly, hole: depth % 2 === 1 };
  });
}
