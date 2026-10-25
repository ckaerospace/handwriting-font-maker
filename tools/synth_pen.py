"""Pen-stroke style synthetic pages: single-stroke Hershey script/simplex glyphs drawn with wobbling pen width, then photographed.
This is a different glyph source than outline fonts (strokes of constant-ish width, open shapes), closer to ball-point writing. Still synthetic."""
import sys, os, json, random, math
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from synth_page import photo, TEXTS

FONTS = {"hershey_script": cv2.FONT_HERSHEY_SCRIPT_COMPLEX, "hershey_simplex": cv2.FONT_HERSHEY_SIMPLEX, "hershey_duplex": cv2.FONT_HERSHEY_DUPLEX}
def render(fontname, lines, seed=0, W=2480, H=3508, scale=2.6, ruled=True, jitter=1.0):
    rnd = random.Random(seed); f = FONTS[fontname]
    ink = np.zeros((H, W), np.uint8); gt = []
    (xw, xh_), bl = cv2.getTextSize("x", f, scale, 3)
    xh = xh_ ; pitch = 3.2 * xh; y = 330
    for li, line in enumerate(lines):
        x = 220 + rnd.uniform(0, 30); base = y + 2.2 * xh
        for ch in line:
            (w, h), _ = cv2.getTextSize(ch, f, scale, 3)
            if ch == " ": x += w * rnd.uniform(0.9, 1.3); continue
            th = max(2, int(round(rnd.gauss(4, 0.7) * jitter / 1.0 + 0.0)))
            lay = np.zeros((int(xh * 4), int(w + xh * 2)), np.uint8)
            cv2.putText(lay, ch, (int(xh * 0.6), int(xh * 2.6)), f, scale * rnd.gauss(1, 0.03 * jitter), 255, th, cv2.LINE_AA)
            # smooth wobble: displace rows/cols with a low-frequency field
            hh, ww = lay.shape; yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)
            fx = cv2.GaussianBlur(np.random.randn(hh, ww).astype(np.float32), (0, 0), 14) * 40 * jitter
            fy = cv2.GaussianBlur(np.random.randn(hh, ww).astype(np.float32), (0, 0), 14) * 40 * jitter
            lay = cv2.remap(lay, xx + fx, yy + fy, cv2.INTER_LINEAR)
            rot = rnd.gauss(0, 2.0 * jitter)
            M = cv2.getRotationMatrix2D((ww / 2, hh / 2), rot, 1)
            lay = cv2.warpAffine(lay, M, (ww, hh))
            px, py = int(x - xh * 0.6), int(base - xh * 2.6 + rnd.gauss(0, 0.04 * xh * jitter))
            if py < 0 or px + ww >= W or py + hh >= H: continue
            ink[py:py + hh, px:px + ww] = np.maximum(ink[py:py + hh, px:px + ww], lay)
            ys, xs = np.nonzero(lay)
            if len(xs):
                gt.append({"ch": ch, "cx": px + (xs.min() + xs.max()) / 2, "cy": py + (ys.min() + ys.max()) / 2, "w": float(xs.max() - xs.min()), "h": float(ys.max() - ys.min()), "line": li})
            x += w * (1 + rnd.gauss(0, 0.03)) + rnd.gauss(0, 0.02) * xh
        y += pitch
    inkA = cv2.GaussianBlur(ink.astype(np.float32) / 255, (0, 0), 0.8)
    paper = np.zeros((H, W, 3), np.float32); paper[:] = (242, 240, 232)
    paper += cv2.GaussianBlur(np.random.randn(H, W).astype(np.float32), (0, 0), 1.5)[..., None] * 6
    if ruled:
        for k in range(30):
            yy = int(330 + 2.2 * xh + k * pitch + 8)
            if yy < H - 60: cv2.line(paper, (60, yy), (W - 60, yy), (205, 170, 120), 3)
        cv2.line(paper, (170, 0), (170, H), (150, 150, 230), 3)
    a = (inkA * 0.95)[..., None]
    page = paper * (1 - a) + np.array((40, 40, 120), np.float32) * a   # blue ball-point
    return np.clip(page, 0, 255).astype(np.uint8), gt, xh

if __name__ == "__main__":
    os.makedirs("/workspace/hfm_test_pen", exist_ok=True)
    ascii_pang = TEXTS["pangram"]
    mixed = ["Dear Anna, I'll see you on 24/11 at 7:30 (maybe 8).", "Prices: 15 + 20 = 35 EUR, 100% done; call 0176-5559.", "Mail me at jo@mail.com #1 - \"quoted\" and 'single'.", "Zoe knows 6 big quirky fjords; 89 jazz vox."]
    k = 0
    for fn, scale in (("hershey_script", 2.4), ("hershey_simplex", 2.6), ("hershey_duplex", 2.6)):
        for tn, lines in (("pangram", ascii_pang), ("mixed", mixed)):
            k += 1
            page, gt, xh = render(fn, lines, seed=k, scale=scale)
            img, gt2, quad, sc = photo(page, gt, seed=k, mode="table" if k % 2 else "white")
            out = f"/workspace/hfm_test_pen/{fn}_{tn}"
            cv2.imwrite(out + ".jpg", img[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 80]); cv2.imwrite(out + "_flat.png", page[..., ::-1])
            json.dump({"family": fn, "lines": lines, "transcript": "\n".join(lines), "gt": gt2, "quad": quad, "scale": sc, "xh_photo": xh * sc, "mode": "pen"}, open(out + ".json", "w"))
            print(out, round(xh * sc, 1))
