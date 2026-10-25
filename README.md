# Handwriting Font Maker

Take a photo or scan of any page of your handwriting and get an installable font (TTF, OTF and WOFF). Everything runs in your browser. Nothing is uploaded, there is no server and no tracking.

Live app: https://handwriting-font-maker-7i91.onrender.com (Render static site, auto-deploys from `main`). Printable template: [A4 PDF](https://handwriting-font-maker-7i91.onrender.com/template/handwriting-template-a4.pdf). Static site, no build step: the app is the `public/` folder.

Screenshots: [template](docs/screenshots/template.png), [review screen on Pixel 7](docs/screenshots/app-review-pixel7.png), [preview in the generated font](docs/screenshots/font-preview-desktop.png).

## How it works

1. **Photo.** Upload any normal handwritten page. The page is found automatically, flattened, its background is normalised, ruled lines are suppressed and the text is deskewed. No markers needed.
2. **Text (optional, recommended).** Type or paste what the page says. Each character is then matched to a letter on the page with dynamic programming (edit distance over candidate letter boundaries), which is far more accurate than guessing. If you skip this, a small on-device classifier reads the letters instead, and you review more.
3. **Check.** Every cut-out letter is shown with its label and confidence. Tap to relabel, delete, split or merge. Doubtful letters are flagged. The screen lists which characters (A-Z, a-z, 0-9, punctuation, German umlauts) are still missing and suggests a sentence to write for them. A second photo adds to the same set and the best sample of each character is kept.
4. **Font.** Live preview through the FontFace API, sliders for letter spacing, side bearing, space width, smoothing and thickness, then download. Missing characters stay empty (your system font is used for them). An optional, off-by-default toggle fills them from Patrick Hand.

The printable **template** (A4 and US Letter PDF in `public/template/`) is an optional "best quality" mode: one box per character, one photo, all 88 characters covered.

Font export: UPM 1000, `.notdef`, space glyph, Unicode cmap, name table with your font name, TrueType (quadratic) and CFF outlines, WOFF (zlib). Written by our own code (`public/js/font.js`) plus opentype.js for the CFF table.

## Measured accuracy (synthetic pages only)

Test pages are synthetic: handwriting-style fonts drawn glyph by glyph with random jitter, then warped, shadowed and noised like a phone photo (`tools/synth_page.py`), plus single-stroke pen pages (`tools/synth_pen.py`). The 12 outline fonts were held out of the classifier training. Run `node tools/dev/t_full.mjs <dir> transcript|auto`.

| Input | Mode | Letters labelled correctly | Letters used in the font that are correct, no review | after fixing only the flagged ones |
|---|---|---|---|---|
| 18 print-style pages (9 fonts) | with text | 98.5% | 98.6% | 98.8% |
| 6 cursive-ish pages (Caveat, Dancing Script, Homemade Apple) | with text | 91.4% | 96.0% | 98.6% |
| 18 print-style pages | no text | 81.2% | 86.1% | 97.5% |
| 6 cursive-ish pages | no text | 55.5% | 63.3% | 93.0% |
| 6 pen-stroke pages (Hershey) | with text | 100% | 100% | 100% |
| 6 pen-stroke pages | no text | 93.4% | 97.0% | 99.7% |

Across all 24 outline-font pages with text: 96.9% of 4628 cut-out letters correct, 97.9% of the letters that end up in the font. Flagging: 93% of wrong labels are flagged, and 17.6% of all letters are flagged, so most flags are false alarms. With no text the flags are stricter (recall 79%, 36% flagged). A page takes 0.7 to 1 s to analyse in Node, 2 s without text.

## Honest limits

* **Synthetic tests.** No real handwriting photos were available to test with. Real pens, paper curl, finger shadows, ink bleed and sloppy letters are harder. Expect more review than the table suggests.
* **Cursive and joined writing** is much weaker than print. Joined letters have to be cut at minimal-ink columns and the cuts are sometimes wrong (for example "Ihe" for "The"). The classifier was trained mostly on print-like glyphs. Use the review step, and consider the template for cursive.
* **No text mode is a fallback.** Do not rely on it for cursive.
* **Rotated pages** (90 degrees or upside down) are not handled. Hold the phone upright over the page. EXIF rotation from phones is honoured by the browser.
* Tested with emulated devices (Playwright: desktop Chromium, iPhone 14 on WebKit, Pixel 7 on Chromium), not on real phones.
* **Installing fonts:** Windows, macOS and Linux install a TTF or OTF directly. iPhone and iPad cannot install a raw font file from the browser, you need an app such as AnyFont. Android has no universal font install, it depends on the phone brand and on apps that accept custom fonts.
* The font is a plain static font: one shape per character, no alternates, no ligatures, no kerning.

## Develop

```sh
npm install
npx playwright install --with-deps chromium webkit
npm run serve                      # http://localhost:8123
node tests/e2e.mjs all             # desktop, iPhone 14 (WebKit), Pixel 7 (Chromium)
BASE_URL=https://your-site/ node tests/e2e.mjs all
python3 tools/validate_font.py my.ttf   # needs fontTools and Pillow
```

`tools/train/` holds the classifier training scripts (PyTorch, CPU). The shipped weights (`public/model/cls.f16`, about 250 KB) are our own. The trainer renders glyphs from locally installed handwriting-style fonts, which are not redistributed. `tools/make_template.py` builds the template PDFs, `tools/make_fallback.py` the fallback outlines.

## Licences

* This project: MIT (see `LICENSE`).
* opentype.js (MIT), vendored in `public/vendor/` for CFF output. Licence in `licenses/`.
* Patrick Hand (SIL OFL 1.1) outlines in `public/model/fallback.json` for the optional fallback toggle. Licence in `licenses/`.
* `public/samples/example-font.*` was generated by this app from synthetic pages drawn from OFL fonts (Patrick Hand, Architects Daughter).
* Dev only: Playwright (Apache-2.0), jpeg-js, pngjs (MIT).
* No external CDNs, fonts or analytics are loaded.
