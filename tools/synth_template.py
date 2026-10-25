"""Fill the printable template with a font (jittered like handwriting) and make a phone-photo style JPEG.
usage: synth_template.py "Family" out_base [--seed N] [--paper a4|letter] [--mode table|crop]"""
import sys, json, random, subprocess, argparse, os
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
from synth_page import font_path, photo
ap = argparse.ArgumentParser(); ap.add_argument("family"); ap.add_argument("out"); ap.add_argument("--seed", type=int, default=0); ap.add_argument("--paper", default="a4"); ap.add_argument("--mode", default="table"); ap.add_argument("--jitter", type=float, default=1.0)
a = ap.parse_args()
tpl = json.load(open("public/template/template.json"))
subprocess.run(["pdftoppm", "-r", "300", "-png", "-singlefile", f"public/template/handwriting-template-{a.paper}.pdf", "/tmp/_tpl"], check=True)
page = np.array(Image.open("/tmp/_tpl.png").convert("RGB")).astype(np.float32)
H, W = page.shape[:2]
rnd = random.Random(a.seed)
gx0, gy0, gx1, gy1 = tpl["grid"]; cw = (gx1 - gx0) * W / tpl["cols"]; ch = (gy1 - gy0) * H / tpl["rows"]
fp = font_path(a.family); f0 = ImageFont.truetype(fp, 100); xh100 = -f0.getbbox("x", anchor="ls")[1]
xh_px = tpl["xh"] * ch * rnd.uniform(0.85, 1.1)
size = int(round(100 * xh_px / xh100)); font = ImageFont.truetype(fp, size)
ink = Image.new("L", (W, H), 0); d = ImageDraw.Draw(ink)
for k, c in enumerate(tpl["chars"]):
    r, col = divmod(k, tpl["cols"])
    x0 = gx0 * W + col * cw; y0 = gy0 * H + r * ch
    bb = font.getbbox(c, anchor="ls"); gw = bb[2] - bb[0]
    x = x0 + (cw - gw) / 2 - bb[0] + rnd.uniform(-0.12, 0.12) * cw * a.jitter
    y = y0 + tpl["base"] * ch + rnd.uniform(-0.05, 0.05) * ch * a.jitter
    lay = Image.new("L", (int(cw * 1.6), int(ch * 1.6)), 0); ImageDraw.Draw(lay).text((lay.width / 2 - gw / 2 - bb[0], lay.height * 0.7), c, font=font, fill=255, anchor="ls")
    lay = lay.rotate(rnd.gauss(0, 2) * a.jitter, resample=Image.BICUBIC)
    ink.paste(lay, (int(round(x + bb[0] - lay.width / 2 + gw / 2 - (-bb[0]) * 0)), int(round(y - lay.height * 0.7))), lay)
inkA = cv2.GaussianBlur(np.array(ink).astype(np.float32) / 255, (0, 0), 0.8)[..., None] * 0.93
pen = np.array((35, 35, 70), np.float32)
page = np.clip(page * (1 - inkA) + pen * inkA, 0, 255).astype(np.uint8)
img, _, quad, sc = photo(page, [{"cx": 1, "cy": 1, "ch": "x", "w": 1, "h": 1, "line": 0}], seed=a.seed, mode=a.mode)
cv2.imwrite(a.out + ".jpg", img[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 82])
json.dump({"family": a.family, "chars": tpl["chars"], "quad": quad}, open(a.out + ".json", "w"))
print("wrote", a.out)
