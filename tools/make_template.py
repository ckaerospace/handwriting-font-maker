"""Generate the printable template (A4 + Letter) and public/template/template.json.
Grid fractions are shared by both paper sizes, the app reads template.json."""
import json, sys, os
from reportlab.lib.pagesizes import A4, letter
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

CHARS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?'\"-()&@#%+=/\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df\u20ac")
COLS, ROWS = 8, 11
GX0, GX1, GY0, GY1 = 0.07, 0.93, 0.105, 0.955   # grid box as fractions of the page
BASE, XH = 0.72, 0.30                           # baseline and x-height as fractions of cell height from the top / cell height
LABEL = (0.0, 0.0, 0.30, 0.17)                  # label zone (fractions of the cell), ink inside is ignored

def build(path, size, font_path):
    W, H = size
    pdfmetrics.registerFont(TTFont("UI", font_path))
    c = canvas.Canvas(path, pagesize=size); c.setTitle("Handwriting Font Maker template"); c.setAuthor("Handwriting Font Maker")
    c.setFillGray(0.1); c.setFont("UI", 16); c.drawString(GX0 * W, H * (1 - 0.045), "Handwriting Font Maker template")
    c.setFont("UI", 8.2); c.setFillGray(0.25)
    lines = ["Use a dark pen (black or dark blue). Write each character once, between the dotted line and the solid line:",
             "small letters sit on the solid line and reach the dotted line, capitals and tall letters go above it, descenders go below.",
             "Do not touch the grey frames. Then photograph the whole page flat and in good light, or scan it."]
    for i, t in enumerate(lines): c.drawString(GX0 * W, H * (1 - 0.066 - i * 0.0135), t)
    cw = (GX1 - GX0) * W / COLS; ch = (GY1 - GY0) * H / ROWS
    for k, chr_ in enumerate(CHARS + [None] * (COLS * ROWS - len(CHARS))):
        r, col = divmod(k, COLS)
        x = GX0 * W + col * cw; y = H - (GY0 * H + (r + 1) * ch)
        c.setStrokeGray(0.82); c.setLineWidth(0.6); c.rect(x, y, cw, ch)
        if chr_ is None: continue
        c.setStrokeGray(0.7); c.setLineWidth(0.5); c.line(x + 1.5 * mm, y + ch * (1 - BASE), x + cw - 1.5 * mm, y + ch * (1 - BASE))
        c.setDash(1.2, 1.8); c.line(x + 1.5 * mm, y + ch * (1 - BASE + XH), x + cw - 1.5 * mm, y + ch * (1 - BASE + XH)); c.setDash()
        c.setFillGray(0.6); c.setFont("UI", 7); c.drawString(x + 1.2 * mm, y + ch - 3.1 * mm, chr_)
    c.setFont("UI", 7); c.setFillGray(0.5); c.drawString(GX0 * W, H * 0.02, "Everything stays on your device. Handwriting Font Maker is free and open source.")
    c.showPage(); c.save()

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "public/template"; fp = sys.argv[2] if len(sys.argv) > 2 else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    os.makedirs(out, exist_ok=True)
    build(f"{out}/handwriting-template-a4.pdf", A4, fp); build(f"{out}/handwriting-template-letter.pdf", letter, fp)
    json.dump({"chars": "".join(CHARS), "cols": COLS, "rows": ROWS, "grid": [GX0, GY0, GX1, GY1], "base": BASE, "xh": XH, "label": LABEL}, open(f"{out}/template.json", "w"), ensure_ascii=False, indent=1)
    print("ok", len(CHARS), "cells")
