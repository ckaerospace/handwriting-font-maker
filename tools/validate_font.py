"""Validate a generated font with fontTools and PIL/FreeType; optionally render a preview PNG.
usage: validate_font.py font.(ttf|otf|woff) [--png out.png] [--text "..."] [--expect-name "My Handwriting"]"""
import sys, argparse
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont
ap = argparse.ArgumentParser(); ap.add_argument("font"); ap.add_argument("--png"); ap.add_argument("--text", default="The quick brown fox jumps over the lazy dog.\nPack my box with five dozen liquor jugs!"); ap.add_argument("--expect-name"); ap.add_argument("--size", type=int, default=64)
a = ap.parse_args()
f = TTFont(a.font)
errs = []
def chk(c, m):
    if not c: errs.append(m)
upm = f["head"].unitsPerEm; chk(upm == 1000, f"UPM {upm}")
order = f.getGlyphOrder(); chk(order[0] == ".notdef", "glyph 0 is not .notdef")
cmap = f.getBestCmap(); chk(cmap and 32 in cmap, "no space in cmap")
n = len(order); chk(f["maxp"].numGlyphs == n, "maxp mismatch")
chk("hmtx" in f and len(f["hmtx"].metrics) == n, "hmtx count")
names = {r.nameID: r.toUnicode() for r in f["name"].names if r.platformID == 3}
chk(1 in names and 4 in names and 6 in names, "name table incomplete")
if a.expect_name: chk(names.get(1) == a.expect_name, f"family name {names.get(1)!r}")
is_ttf = "glyf" in f
nm = 0
if is_ttf:
    g = f["glyf"]
    for gn in order:
        gl = g[gn]
        if gl.numberOfContours > 0:
            gl.recalcBounds(g); nm += 1
    chk(g[".notdef"].numberOfContours > 0, ".notdef empty")
chk(f["hmtx"]["space"][0] > 50, "space advance too small")
# cmap glyphs all drawable except space
empty = [chr(c) for c, gn in cmap.items() if c != 32 and (is_ttf and f["glyf"][gn].numberOfContours == 0)]
chk(not empty, f"empty glyphs for {empty}")
# PIL / FreeType render
font = ImageFont.truetype(a.font if not a.font.endswith(".woff") else a.font, a.size)
img = Image.new("L", (1400, 100 + 110 * len(a.text.split("\n"))), 255); d = ImageDraw.Draw(img)
y = 20
for ln in a.text.split("\n"):
    d.text((30, y), ln, font=font, fill=0); y += 110
ink = sum(1 for v in img.getdata() if v < 128)
chk(ink > 500, f"rendered ink only {ink}px")
if a.png: img.save(a.png)
print(f"{a.font}: glyphs={n} mapped={len(cmap)} contours_glyphs={nm} type={'TrueType' if is_ttf else 'CFF'} family={names.get(1)!r} ink_px={ink}")
if errs: print("FAIL:", "; ".join(errs)); sys.exit(1)
print("OK")
