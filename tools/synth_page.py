"""Synthetic phone photos of a handwritten page, rendered from handwriting-style fonts.
Everything here is SYNTHETIC: a font is drawn glyph by glyph with random jitter, then warped like a phone photo.
Ground truth (per-character positions in photo coordinates) is written next to the image."""
import sys, os, json, math, random, argparse
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "train"))
from common import list_fonts

TEXTS = {
 "pangram": [
  "The quick brown fox jumps over the lazy dog.",
  "Pack my box with five dozen liquor jugs!",
  "How vexingly quick daft zebras jump?",
  "Sphinx of black quartz, judge my vow.",
  "Waltz, bad nymph, for quick jigs vex.",
  "Big Jim's WIFI works: QUIZ Xavier, FLY.",
 ],
 "mixed": [
  "Dear Anna, I'll see you on 24/11 at 7:30 (maybe 8).",
  "Prices: 15 + 20 = 35 EUR, 100% done; call 0176-5559.",
  "Gr\u00fc\u00dfe aus M\u00fcnchen: \u00c4rzte, \u00d6l, \u00dcbung & Spa\u00df!",
  "Mail me at jo@mail.com #1 - \"quoted\" and 'single'.",
  "Zoe knows 6 big quirky fjords; 89 jazz vox.",
 ],
 "short": [
  "Hello world, this is my handwriting.",
  "I hope you like it a lot!",
 ],
}

def font_path(family):
    for p, fam, style in list_fonts():
        if fam.lower() == family.lower() and (style.lower() in ("regular", "", "book", "medium") or "regular" in style.lower()):
            return p
    for p, fam, style in list_fonts():
        if fam.lower() == family.lower(): return p
    raise SystemExit("font not found " + family)

def render_page(family, lines, xh_px=36, jitter=1.0, ruled=False, seed=0, W=2480, H=3508, pitch=3.0, pen=(35, 35, 70)):
    rnd = random.Random(seed)
    fp = font_path(family)
    f0 = ImageFont.truetype(fp, 100)
    xh100 = -f0.getbbox("x", anchor="ls")[1]
    size = int(round(100 * xh_px / xh100))
    font = ImageFont.truetype(fp, size)
    xh = -font.getbbox("x", anchor="ls")[1]
    ink = Image.new("L", (W, H), 0)
    gt = []
    left = 220; top = 330
    y = top
    pitch_px = pitch * xh
    for li, line in enumerate(lines):
        x = left + rnd.uniform(0, 30)
        base = y + 2.2 * xh + li * 0 + rnd.uniform(-0.1, 0.1) * xh
        drift = rnd.uniform(-0.02, 0.02) * jitter  # slope of baseline (fraction per px)
        wob = 0
        for ci, ch in enumerate(line):
            adv = font.getlength(ch)
            if ch == " ":
                x += adv * rnd.uniform(0.9, 1.25); continue
            wob = 0.7 * wob + rnd.gauss(0, 0.035) * xh * jitter
            by = base + wob + (x - left) * drift * 0.1
            rot = rnd.gauss(0, 1.8) * jitter
            sc = 1 + rnd.gauss(0, 0.035) * jitter
            bb = font.getbbox(ch, anchor="ls")
            pad = int(xh * 1.2)
            gw = int((bb[2] - bb[0]) + 2 * pad); gh = int((bb[3] - bb[1]) + 2 * pad)
            lay = Image.new("L", (max(gw, 4), max(gh, 4)), 0)
            d = ImageDraw.Draw(lay)
            ox, oy = pad - bb[0], pad - bb[1]
            d.text((ox, oy), ch, font=font, fill=255, anchor="ls")
            c = (lay.width / 2, lay.height / 2)
            lay = lay.rotate(rot, resample=Image.BICUBIC, center=c)
            if abs(sc - 1) > 1e-3:
                lay = lay.resize((max(1, int(lay.width * sc)), max(1, int(lay.height * sc))), Image.BICUBIC)
            px, py = int(round(x - ox * sc)), int(round(by - oy * sc))
            ink.paste(Image.composite(Image.new("L", lay.size, 255), ink.crop((px, py, px + lay.width, py + lay.height)), lay) if False else lay, (px, py), lay)
            # ground truth glyph box (without jitter detail): centre of ink bbox
            cx = x + (bb[0] + bb[2]) / 2 * 1.0; cy = by + (bb[1] + bb[3]) / 2
            gt.append({"ch": ch, "cx": cx, "cy": cy, "w": bb[2] - bb[0], "h": bb[3] - bb[1], "line": li})
            x += adv * (1 + rnd.gauss(0, 0.02) * jitter) + rnd.gauss(0, 0.02) * xh * jitter
        y += pitch_px
    inkA = np.array(ink).astype(np.float32) / 255
    inkA = cv2.GaussianBlur(inkA, (0, 0), 0.7)
    paper = np.zeros((H, W, 3), np.float32); paper[:] = (240, 238, 230)
    # paper texture
    paper += cv2.GaussianBlur(np.random.randn(H, W).astype(np.float32), (0, 0), 1.5)[..., None] * 6
    if ruled:
        for k in range(30):
            yy = int(top + 2.2 * xh + k * pitch_px + 6)
            if yy < H - 60: cv2.line(paper, (60, yy), (W - 60, yy), (200, 170, 130), 3)  # light blue (BGR order irrelevant here: RGB)
    pen_col = np.array(pen, np.float32)
    a = (inkA * 0.93)[..., None]
    page = paper * (1 - a) + pen_col * a
    return np.clip(page, 0, 255).astype(np.uint8), gt, xh

def photo(page, gt, seed=0, mode="table", out_w=3024, out_h=4032, shadow=True, rot=3.0, persp=1.0):
    rnd = random.Random(seed + 7); np.random.seed(seed + 7)
    H, W = page.shape[:2]
    src = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    if mode == "crop":   # page fills the frame, mild perspective only
        m = 120
        dst = np.float32([[rnd.uniform(0, m), rnd.uniform(0, m)], [out_w - rnd.uniform(0, m), rnd.uniform(0, m)],
                          [out_w - rnd.uniform(0, m), out_h - rnd.uniform(0, m)], [rnd.uniform(0, m), out_h - rnd.uniform(0, m)]])
        dst = np.float32([[0, 0], [out_w, 0], [out_w, out_h], [0, out_h]]) * 1.0
        dst += np.float32([[rnd.uniform(-1, 1) * 20 * persp, rnd.uniform(-1, 1) * 20 * persp] for _ in range(4)])
        scale = np.array([out_w / W, out_h / H])
    else:
        mx, my = 280, 330
        dst = np.float32([[mx + rnd.uniform(-60, 60) * persp, my + rnd.uniform(-60, 60) * persp],
                          [out_w - mx + rnd.uniform(-90, 90) * persp, my + rnd.uniform(-60, 60) * persp],
                          [out_w - mx + rnd.uniform(-90, 90) * persp, out_h - my + rnd.uniform(-100, 100) * persp],
                          [mx + rnd.uniform(-60, 60) * persp, out_h - my + rnd.uniform(-100, 100) * persp]])
        # rotate quad around centre
        a = math.radians(rnd.uniform(-rot, rot)); c = np.array([out_w / 2, out_h / 2])
        R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
        dst = ((dst - c) @ R.T + c).astype(np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    # background
    yy, xx = np.mgrid[0:out_h, 0:out_w].astype(np.float32)
    bg = np.zeros((out_h, out_w, 3), np.float32); bg[:] = (115, 88, 62) if mode != "white" else (235, 235, 235)
    bg += cv2.GaussianBlur(np.random.randn(out_h, out_w).astype(np.float32), (0, 0), 6)[..., None] * 10
    warped = cv2.warpPerspective(page, M, (out_w, out_h), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_CONSTANT).astype(np.float32)
    mask = cv2.warpPerspective(np.full((H, W), 255, np.uint8), M, (out_w, out_h), flags=cv2.INTER_LINEAR)
    mask = (cv2.GaussianBlur(mask, (0, 0), 1.2).astype(np.float32) / 255)[..., None]
    img = bg * (1 - mask) + warped * mask
    if shadow:
        g = 0.62 + 0.38 * (xx / out_w * 0.6 + (1 - yy / out_h) * 0.4) + 0.0
        sx, sy = rnd.uniform(0.2, 0.8) * out_w, rnd.uniform(0.2, 0.8) * out_h
        blob = np.exp(-(((xx - sx) / (0.25 * out_w)) ** 2 + ((yy - sy) / (0.18 * out_h)) ** 2))
        g = g * (1 - 0.30 * blob)
        img *= g[..., None]
    img += np.random.randn(out_h, out_w, 3).astype(np.float32) * 3.5
    img = cv2.GaussianBlur(img, (0, 0), 0.9)
    img = np.clip(img, 0, 255).astype(np.uint8)
    # ground truth in photo coordinates
    pts = np.array([[g["cx"], g["cy"]] for g in gt], np.float32).reshape(-1, 1, 2)
    p2 = cv2.perspectiveTransform(pts, M).reshape(-1, 2)
    sc = float(np.sqrt(abs(np.linalg.det(M[:2, :2]))))
    out = []
    for g, p in zip(gt, p2):
        out.append({"ch": g["ch"], "x": float(p[0]), "y": float(p[1]), "w": g["w"] * sc, "h": g["h"] * sc, "line": g["line"]})
    return img, out, dst.tolist(), sc

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("family"); ap.add_argument("text"); ap.add_argument("out")
    ap.add_argument("--seed", type=int, default=0); ap.add_argument("--mode", default="table")
    ap.add_argument("--ruled", action="store_true"); ap.add_argument("--jitter", type=float, default=1.0)
    ap.add_argument("--flat", action="store_true"); ap.add_argument("--xh", type=float, default=36); ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--w", type=int, default=3024); ap.add_argument("--h", type=int, default=4032)
    a = ap.parse_args()
    lines = TEXTS[a.text]
    page, gt, xh = render_page(a.family, lines, xh_px=a.xh, jitter=a.jitter, ruled=a.ruled, seed=a.seed)
    img, gt2, quad, sc = photo(page, gt, seed=a.seed, mode=a.mode, out_w=a.w, out_h=a.h)
    cv2.imwrite(a.out + ".jpg", img[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, a.quality])
    if a.flat: cv2.imwrite(a.out + "_flat.png", page[..., ::-1])
    json.dump({"family": a.family, "lines": lines, "transcript": "\n".join(lines), "gt": gt2, "quad": quad, "scale": sc, "xh_photo": xh * sc, "mode": a.mode},
              open(a.out + ".json", "w"))
    print("wrote", a.out, "xh photo px", round(xh * sc, 1))
