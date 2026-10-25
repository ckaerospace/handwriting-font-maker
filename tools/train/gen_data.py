import sys, random, os, math, json
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(__file__))
from common import *

BAD = re.compile(r"symbol|dingbat|wingding|emoji|icon|awesome|material|math|noto sans (?!display)\w+ |webdings|bravura|music|cjk|braille|ornament|barcode|lastresort|mono.*nerd|glyph", re.I)

def usable(path, fam):
    if BAD.search(fam) or BAD.search(path): return False
    if any(fam.lower().startswith(h.lower()) for h in HELD_OUT): return False
    try:
        f = TTFont(path, lazy=True, fontNumber=0)
        cm = f.getBestCmap()
        need = [ord(c) for c in "AaBbQqgxz0189.,!?"]
        return all(c in cm for c in need)
    except Exception:
        return False

def pick_fonts(seed=1):
    rnd = random.Random(seed)
    fam_files = collections.OrderedDict()
    for p, fam, style in list_fonts():
        fam_files.setdefault(fam, []).append((p, style))
    chosen = []
    for fam, lst in fam_files.items():
        hand = bool(HAND_WORDS.search(fam))
        lst = list(lst); rnd.shuffle(lst)
        cnt = 0
        for p, style in lst:
            if cnt >= (3 if hand else 1): break
            if re.search(r"italic|oblique", style, re.I) and not hand and cnt == 0 and len(lst) > 1: continue
            if not usable(p, fam): break
            chosen.append((p, fam, hand)); cnt += 1
    return chosen

def glyph_img(font, ch, S=120):
    """Render char on a canvas, return (gray float32 ink image cropped, baseline-relative geometry) or None."""
    W = int(S * 2.2); H = int(S * 2.2)
    im = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(im)
    bx, by = int(S * 0.5), int(S * 1.4)
    d.text((bx, by), ch, font=font, fill=255, anchor="ls")
    a = np.array(im)
    return a, bx, by

def xheight(font):
    b = font.getbbox("x", anchor="ls")
    return -b[1]

def augment(a, bx, by, xh, rnd):
    """a: uint8 ink image, baseline at row by. returns transformed image and baseline row (float)"""
    H, W = a.shape
    rot = rnd.gauss(0, 4.5); shear = rnd.gauss(0.0, 0.12); sx = math.exp(rnd.gauss(0, 0.10)); sy = math.exp(rnd.gauss(0, 0.08))
    th = math.radians(rot)
    # affine around the baseline origin
    M = np.array([[sx*math.cos(th), -sx*math.sin(th)+shear, 0], [sy*math.sin(th), sy*math.cos(th), 0]], np.float32)
    cx, cy = bx, by
    M[0, 2] = cx - (M[0, 0]*cx + M[0, 1]*cy); M[1, 2] = cy - (M[1, 0]*cx + M[1, 1]*cy)
    b = cv2.warpAffine(a, M, (W, H), flags=cv2.INTER_LINEAR)
    # stroke weight
    k = rnd.random()
    r = max(1, int(xh * 0.03)) 
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*r+1, 2*r+1))
    if k < 0.3: b = cv2.dilate(b, ker, iterations=rnd.choice([1, 1, 2]))
    elif k < 0.5: b = cv2.erode(b, ker, iterations=1)
    if rnd.random() < 0.5:  # wobble: smooth elastic
        dx = cv2.GaussianBlur((np.random.rand(H, W).astype(np.float32) - .5), (0, 0), 14) * rnd.uniform(40, 160)
        dy = cv2.GaussianBlur((np.random.rand(H, W).astype(np.float32) - .5), (0, 0), 14) * rnd.uniform(40, 160)
        gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
        b = cv2.remap(b, gx + dx, gy + dy, cv2.INTER_LINEAR)
    # new baseline row after transform
    nby = M[1, 0]*bx + M[1, 1]*by + M[1, 2]
    return b, nby

def add_connectors(b, by, xh, rnd):
    """cursive entry/exit strokes and neighbour slivers at the sides"""
    ys, xs = np.nonzero(b > 128)
    if len(xs) == 0: return b
    x0, x1 = xs.min(), xs.max()
    b = b.copy()
    sw = max(2, int(xh * 0.09 * rnd.uniform(0.6, 1.4)))
    if rnd.random() < 0.35:
        L = int(xh * rnd.uniform(0.1, 0.45)); y = int(by - xh * rnd.uniform(0.0, 0.35))
        cv2.line(b, (max(0, x0 - L), y), (x0 + 1, y + rnd.randint(-3, 3)), 255, sw)
    if rnd.random() < 0.35:
        L = int(xh * rnd.uniform(0.1, 0.45)); y = int(by - xh * rnd.uniform(0.0, 0.5))
        cv2.line(b, (x1 - 1, y + rnd.randint(-3, 3)), (min(b.shape[1] - 1, x1 + L), y), 255, sw)
    return b

def to_sample(b, by, xh, rnd, out=24):
    ys, xs = np.nonzero(b > 100)
    if len(xs) < 4: return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    w, h = x1 - x0, y1 - y0
    xhn = xh * math.exp(rnd.gauss(0, 0.12))  # imperfect x-height estimate
    geo = np.array([min(w / xhn, 4) / 2, min(h / xhn, 4) / 2, np.clip((by - y0) / xhn, -1, 3.5) / 2, np.clip((by - y1) / xhn, -1.5, 3) / 2,
                    min(w / h, 6) / 3], np.float32)
    crop = b[y0:y1, x0:x1].astype(np.float32) / 255
    s = (out - 2) / max(w, h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    r = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
    img = np.zeros((out, out), np.float32)
    ox, oy = (out - nw) // 2, (out - nh) // 2
    img[oy:oy + nh, ox:ox + nw] = r
    if rnd.random() < 0.5: img = cv2.GaussianBlur(img, (0, 0), rnd.uniform(0.3, 0.7))
    return img, geo

def worker(args):
    path, fam, hand, seed, reps = args
    rnd = random.Random(seed); np.random.seed(seed % (2**32))
    try:
        font = ImageFont.truetype(path, 120)
    except Exception:
        return [], [], [], None
    try: cmap = TTFont(path, lazy=True, fontNumber=0).getBestCmap()
    except Exception: return [], [], [], None
    xh = xheight(font)
    if xh < 120 * 0.18 or xh > 120 * 0.8: return [], [], [], None
    imgs, geos, ys = [], [], []
    base = {}
    for i, ch in enumerate(CHARS):
        if ord(ch) not in cmap: continue
        try:
            a, bx, by = glyph_img(font, ch)
        except Exception:
            continue
        if a.max() == 0: continue
        ysn, xsn = np.nonzero(a > 100)
        if ch in "AaBbxz09" and False: pass
        base[ch] = (a, bx, by, i)
    if len(base) < len(CHARS) - 12: return [], [], [], None
    # advance priors
    adv = {ch: font.getlength(ch) / xh for ch in CHARS if ord(ch) in cmap}
    for ch, (a, bx, by, i) in base.items():
        for r in range(reps):
            b, nby = augment(a, bx, by, xh, rnd)
            b = add_connectors(b, nby, xh, rnd)
            s = to_sample(b, nby, xh, rnd)
            if s: imgs.append(s[0]); geos.append(s[1]); ys.append(i)
    # junk: partial glyphs, double glyphs
    chs = list(base.keys())
    for j in range(int(len(chs) * reps * 0.35)):
        mode = rnd.random()
        ch = rnd.choice(chs); a, bx, by, i = base[ch]
        b, nby = augment(a, bx, by, xh, rnd)
        yy, xx = np.nonzero(b > 100)
        if len(xx) < 10: continue
        x0, x1 = xx.min(), xx.max()
        if x1 - x0 < xh * 0.3: continue
        if mode < 0.45:  # half glyph
            c = int(x0 + (x1 - x0) * rnd.uniform(0.3, 0.7))
            b = b.copy()
            if rnd.random() < 0.5: b[:, c:] = 0
            else: b[:, :c] = 0
        elif mode < 0.9:  # two glyphs
            ch2 = rnd.choice(chs); a2, bx2, by2, i2 = base[ch2]
            b2, nby2 = augment(a2, bx2, by2, xh, rnd)
            yy2, xx2 = np.nonzero(b2 > 100)
            if len(xx2) < 10: continue
            gap = int(xh * rnd.uniform(-0.15, 0.15))
            shift = x1 + gap - xx2.min()
            canvas = np.zeros((b.shape[0], b.shape[1] + 400), np.uint8)
            canvas[:, :b.shape[1]] = b
            sh = int(round(nby - nby2)); 
            b2s = np.roll(b2, sh, axis=0)
            w2 = b2s.shape[1]
            xs0 = max(0, shift)
            seg = b2s[:, :min(w2, canvas.shape[1] - xs0 - 1)] if shift >= 0 else b2s[:, -shift:]
            canvas[:, xs0:xs0 + seg.shape[1]] = np.maximum(canvas[:, xs0:xs0 + seg.shape[1]], seg)
            b = canvas
        else:  # random fragment
            ys0, ys1 = np.nonzero(b > 100)[0].min(), np.nonzero(b > 100)[0].max()
            c = int(ys0 + (ys1 - ys0) * rnd.uniform(0.35, 0.65))
            b = b.copy()
            if rnd.random() < 0.5: b[c:, :] = 0
            else: b[:c, :] = 0
        s = to_sample(b, nby, xh, rnd)
        if s: imgs.append(s[0]); geos.append(s[1]); ys.append(JUNK)
    return imgs, geos, ys, (fam, hand, adv)

if __name__ == "__main__":
    reps = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    fonts = pick_fonts()
    print("fonts", len(fonts), "hand-ish", sum(1 for f in fonts if f[2]), flush=True)
    jobs = [(p, fam, hand, 1000 + k, reps * (2 if hand else 1)) for k, (p, fam, hand) in enumerate(fonts)]
    X, G, Y = [], [], []
    advs = collections.defaultdict(list)
    used = 0
    with Pool(8) as pool:
        for imgs, geos, ys, meta in pool.imap_unordered(worker, jobs, chunksize=4):
            if meta is None: continue
            used += 1
            X += imgs; G += geos; Y += ys
            fam, hand, adv = meta
            if hand:
                for ch, v in adv.items(): advs[ch].append(v)
    print("used fonts", used, "samples", len(Y), flush=True)
    X = np.array(X, np.float16); G = np.array(G, np.float16); Y = np.array(Y, np.int16)
    np.savez_compressed("/workspace/hfm_train.npz", X=X, G=G, Y=Y)
    pri = {}
    for ch, v in advs.items():
        lv = np.log(np.clip(np.array(v), 0.05, 6))
        med = float(np.median(lv)); mad = float(np.median(np.abs(lv - med)) * 1.4826)
        pri[ch] = [round(med, 4), round(max(mad, 0.12), 4)]
    json.dump(pri, open("/workspace/hfm_wprior.json", "w"))
    print("done")
