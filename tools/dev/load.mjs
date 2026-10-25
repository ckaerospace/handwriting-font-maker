import fs from "fs";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
export function loadImage(p) {
  const buf = fs.readFileSync(p);
  if (p.endsWith(".png")) { const im = PNG.sync.read(buf); return { data: im.data, w: im.width, h: im.height }; }
  const im = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { data: im.data, w: im.width, h: im.height };
}
export function savePNG(p, gray, w, h, scale = 1) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) { const v = Math.max(0, Math.min(255, Math.round(gray[i] * 255 * scale))); png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v; png.data[i * 4 + 3] = 255; }
  fs.writeFileSync(p, PNG.sync.write(png));
}
