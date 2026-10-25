"""Extract a small plain base font (Patrick Hand, SIL OFL 1.1) as JSON outlines for the optional
"fill missing characters" toggle. Output: public/model/fallback.json  {char: {contours: [[[x,y,on],...]]}}.
Scaled so the x-height is 500 units (UPM 1000), same as the handwriting glyphs."""
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
src = sys.argv[1]; out = sys.argv[2]
f = TTFont(src); gs = f.getGlyphSet(); cmap = f.getBestCmap(); glyf = f["glyf"]
xh = f["OS/2"].sxHeight or 500
k = 500.0 / xh
chars = list("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?'\"-()&@#%+=/\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df\u20ac")
res = {}
for ch in chars:
    gn = cmap.get(ord(ch))
    if not gn: print("missing", ch); continue
    pen = TTGlyphPen(gs); gs[gn].draw(pen); g = pen.glyph()
    if g.numberOfContours <= 0: continue
    coords, ends, flags = g.getCoordinates(glyf)
    cs = []; s = 0
    for e in ends:
        pts = [[round(x * k), round(y * k), int(fl & 1)] for (x, y), fl in zip(coords[s:e + 1], flags[s:e + 1])]
        cs.append(pts); s = e + 1
    res[ch] = {"contours": cs}
json.dump(res, open(out, "w"), separators=(",", ":"), ensure_ascii=False)
print(len(res), "glyphs ->", out)
