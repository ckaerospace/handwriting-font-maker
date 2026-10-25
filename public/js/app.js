// UI controller. All heavy work happens in js/worker.js.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const BASE = new URL("../", import.meta.url).href;

/* ---------- worker client ---------- */
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let seq = 0; const pending = new Map();
worker.onmessage = (e) => {
  const m = e.data, p = pending.get(m.id); if (!p) return;
  if (m.progress !== undefined) { p.onProgress && p.onProgress(m.progress); return; }
  pending.delete(m.id);
  m.ok ? p.resolve(m.data) : p.reject(new Error(m.error));
};
worker.onerror = (e) => showError("The analysis engine failed to start: " + (e.message || "unknown error") + ". Try a current Safari, Chrome, Edge or Firefox.");
function call(cmd, args = {}, transfer = [], onProgress) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject, onProgress }); worker.postMessage({ id, cmd, args }, transfer); });
}
const ready = call("init", { base: BASE });

/* ---------- state ---------- */
const S = { photos: [], views: null, filter: "check", fontSeq: 0, fontFace: null, tpl: null, pendingAdd: false, ovPhoto: 0, ovBoxes: [], edSid: null, building: null, busy: false };
window.__hfm = S; // handy for tests

/* ---------- helpers ---------- */
function showError(msg) { const e = $("#error"); e.textContent = msg; e.hidden = !msg; if (msg) e.scrollIntoView({ block: "nearest" }); }
function showStep(name) {
  for (const id of ["upload", "text", "review", "font"]) $("#s-" + id).hidden = id !== name;
  const order = ["upload", "text", "review", "font"], at = order.indexOf(name);
  $$("#steps li").forEach((li, i) => { li.classList.toggle("on", i === at); li.classList.toggle("done", i < at); });
  window.scrollTo({ top: 0 });
}
function busy(on, text) {
  S.busy = on; const p = $("#progress"); p.hidden = !on; $("#progressText").textContent = text || "Working";
  $$("#s-text .btn").forEach(b => b.disabled = on);
  if (on) setProgress(0.05);
}
function setProgress(f) { $("#progress div").style.width = Math.round(f * 100) + "%"; }

async function decode(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.decoding = "async"; img.src = url;
    try { await img.decode(); } catch { throw new Error("This image could not be read. Please use a JPG or PNG photo or scan."); }
    let w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error("This image could not be read. Please use a JPG or PNG photo or scan.");
    const k = Math.min(1, 3000 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
    return { rgba: g.getImageData(0, 0, w, h).data.buffer, w, h };
  } finally { URL.revokeObjectURL(url); }
}

function drawGray(canvas, view, lines) {
  canvas.width = view.w; canvas.height = view.h;
  const g = canvas.getContext("2d"), im = g.createImageData(view.w, view.h);
  // ink in dark blue on paper white
  for (let i = 0; i < view.gray.length; i++) { const t = view.gray[i] / 255; im.data[i * 4] = 25 + 230 * t; im.data[i * 4 + 1] = 25 + 230 * t; im.data[i * 4 + 2] = 70 + 185 * t; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
  if (lines) { g.fillStyle = "rgba(29,63,191,0.07)"; g.strokeStyle = "rgba(29,63,191,0.5)"; g.lineWidth = 1; for (const L of lines) { const y0 = L.y0 * view.k, y1 = L.y1 * view.k; g.fillRect(0, y0, view.w, y1 - y0); g.strokeRect(0.5, y0, view.w - 1, y1 - y0); } }
}

/* ---------- step 1: upload ---------- */
const fileIn = $("#file"), camIn = $("#camera"), tplIn = $("#fileTpl");
$("#pick").onclick = () => fileIn.click();
$("#shoot").onclick = () => camIn.click();
$("#pickTpl").onclick = () => tplIn.click();
fileIn.onchange = camIn.onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) startPhoto(f, "free"); };
tplIn.onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) startPhoto(f, "template"); };
const drop = $("#drop");
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) startPhoto(f, "free"); });
let samples = [];
fetch("samples/samples.json").then(r => r.json()).then(j => { samples = j; }).catch(() => {});
async function startSample(i) {
  showError("");
  try { const s = samples[i]; const blob = await (await fetch(s.file)).blob(); await startPhoto(blob, "free", { name: s.title, text: s.text }); }
  catch (err) { showError("Could not load the sample: " + err.message); }
}
$("#sample0").onclick = () => startSample(0);
$("#sample1").onclick = () => startSample(1);

async function startPhoto(blob, kind, extra = {}) {
  showError("");
  try {
    $$("#s-upload .btn").forEach(b => b.disabled = true);
    const dec = await decode(blob);
    await ready;
    if (kind === "template") {
      if (!S.tpl) S.tpl = await (await fetch("template/template.json")).json();
      const r = await call("template", { rgba: dec.rgba, w: dec.w, h: dec.h, tpl: S.tpl }, [dec.rgba]);
      S.photos[r.id] = { id: r.id, name: extra.name || blob.name || "template", kind, info: r, view: r.view };
      if (!r.filled) throw new Error("No handwriting was found in the template frames. Make sure the whole page is in the photo, flat and well lit.");
      S.views = await call("views");
      afterLabel(r.id, r.usedQuad ? "" : "The page edges were not found, so the whole photo was treated as the page. If letters look wrong, retake the photo with the page on a darker surface.");
      return;
    }
    const r = await call("prepare", { rgba: dec.rgba, w: dec.w, h: dec.h, opts: {} }, [dec.rgba]);
    S.photos[r.id] = { id: r.id, name: extra.name || blob.name || "photo", kind, info: r, view: r.view };
    if (!r.lines.length) throw new Error("No handwriting was found in this photo. Use dark ink on light paper, in good light, and get close enough to fill the frame.");
    S.cur = r.id; openText(r, extra.text);
  } catch (err) { showError(err.message); showStep(S.photos.length && S.views ? "review" : "upload"); }
  finally { $$("#s-upload .btn").forEach(b => b.disabled = false); }
}

/* ---------- step 2: text ---------- */
function openText(r, text) {
  showStep("text");
  drawGray($("#pagePrev"), r.view, r.lines);
  $("#pageInfo").textContent = `Found ${r.lines.length} line${r.lines.length === 1 ? "" : "s"} of writing.` + (r.usedQuad ? " The page was straightened." : "");
  const ta = $("#transcript"); if (text !== undefined) ta.value = text; else if (!S.pendingAdd) ta.value = "";
  updateLineInfo();
}
function updateLineInfo() {
  const r = S.photos[S.cur]; if (!r) return;
  const t = $("#transcript").value.split("\n").filter(l => l.trim()).length, n = r.info.lines.length;
  $("#lineInfo").textContent = t ? (t === n ? `Your text has ${t} lines, matching the ${n} lines found.` : `Your text has ${t} line${t === 1 ? "" : "s"}, ${n} found on the page. That is fine, the match is done by position and shape.`) : "";
}
$("#transcript").addEventListener("input", updateLineInfo);
$("#backUpload").onclick = () => showStep(S.views ? "review" : "upload");
async function runLabel(text) {
  showError(""); busy(true, text ? "Matching your text to the page" : "Recognising letters");
  try {
    const r = S.photos[S.cur]; const n = r.info.lines.length, t = text.split("\n").filter(l => l.trim()).length;
    const used = text && t !== n ? text.replace(/\s*\n\s*/g, " ") : text; // mismatched line breaks: align by words only
    S.views = await call("label", { photo: S.cur, text: used }, [], p => setProgress(0.05 + 0.9 * p));
    setProgress(1);
    if (!S.views.glyphs.some(g => g.photo === S.cur)) { showError("No letters could be read from this photo. Check the text matches the page, or try a clearer photo."); return; }
    afterLabel(S.cur, "");
  } catch (err) { showError("Analysis failed: " + err.message); }
  finally { busy(false); }
}
$("#go").onclick = () => runLabel($("#transcript").value);
$("#goAuto").onclick = () => runLabel("");

/* ---------- step 3: review ---------- */
function afterLabel(photo, note) {
  S.pendingAdd = false; S.ovPhoto = photo; S.filter = "check";
  showStep("review"); renderReview(); if (note) showError(note);
}
function renderReview() {
  const V = S.views, gl = V.glyphs;
  const used = gl.filter(g => g.used), check = gl.filter(g => !g.deleted && g.flag && (g.used || !g.ch)), rem = gl.filter(g => g.deleted);
  $("#summary").innerHTML = "";
  const pill = (t, c = "") => { const s = document.createElement("span"); s.className = "pill " + c; s.textContent = t; $("#summary").append(s); };
  pill(`${gl.length - rem.length} glyphs found`);
  pill(`${V.covered} of ${V.total} characters covered`, V.covered === V.total ? "ok" : "warn");
  if (check.length) pill(`${check.length} to check`, "warn"); else pill("nothing flagged", "ok");
  $("#nCheck").textContent = check.length; $("#nUsed").textContent = used.length; $("#nAll").textContent = gl.length - rem.length; $("#nRem").textContent = rem.length;
  // missing
  const mb = $("#missingBox"); mb.hidden = !V.missing.length;
  if (V.missing.length) {
    $("#missingChips").replaceChildren(...V.missing.map(c => { const s = document.createElement("span"); s.textContent = c; return s; }));
    $("#suggest").replaceChildren(...V.suggestions.map(t => { const p = document.createElement("p"); p.textContent = t; return p; }));
  }
  $$("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.f === S.filter));
  let list = S.filter === "check" ? check : S.filter === "used" ? used : S.filter === "removed" ? rem : gl.filter(g => !g.deleted);
  if (S.filter === "used") list = list.slice().sort((a, b) => a.ch.localeCompare(b.ch));
  const grid = $("#grid"); grid.replaceChildren();
  if (!list.length) { const p = document.createElement("p"); p.className = "muted"; p.textContent = S.filter === "check" ? "Nothing needs checking. Look at the other tabs to review everything." : "Nothing here."; grid.append(p); }
  for (const g of list.slice(0, 600)) grid.append(card(g));
  drawOverlay();
}
function glyphCanvas(g, w, h, box) {
  const c = document.createElement("canvas"); const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = w * dpr; c.height = h * dpr; const x = c.getContext("2d");
  const sc = Math.min((w - 8) / g.w, (h - 8) / g.h, box || 99);
  const ox = (w - g.w * sc) / 2, oy = (h - g.h * sc) / 2;
  const t = document.createElement("canvas"); t.width = g.w; t.height = g.h; const tg = t.getContext("2d"), im = tg.createImageData(g.w, g.h);
  for (let i = 0; i < g.alpha.length; i++) { im.data[i * 4] = 23; im.data[i * 4 + 1] = 23; im.data[i * 4 + 2] = 60; im.data[i * 4 + 3] = g.alpha[i]; }
  tg.putImageData(im, 0, 0);
  x.scale(dpr, dpr); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
  x.strokeStyle = "rgba(29,63,191,0.35)"; x.lineWidth = 1; x.beginPath(); const by = oy + g.base * sc; x.moveTo(0, by); x.lineTo(w, by); x.stroke();
  x.setLineDash([3, 3]); x.beginPath(); const xy = by - g.xh * sc; x.moveTo(0, xy); x.lineTo(w, xy); x.stroke(); x.setLineDash([]);
  x.imageSmoothingEnabled = true; x.drawImage(t, ox, oy, g.w * sc, g.h * sc);
  if (g.cutL) { x.fillStyle = "rgba(192,57,43,.5)"; x.fillRect(ox, oy, 2, g.h * sc); }
  if (g.cutR) { x.fillStyle = "rgba(192,57,43,.5)"; x.fillRect(ox + g.w * sc - 2, oy, 2, g.h * sc); }
  return { c, sc, ox, oy };
}
function card(g) {
  const b = document.createElement("button"); b.type = "button"; b.dataset.sid = g.sid; b.setAttribute("data-testid", "glyph");
  b.className = "gcard " + (g.deleted ? "rm" : g.flag ? "check" : g.used ? "ok" : "unused");
  b.append(glyphCanvas(g, 64, 56).c);
  const l = document.createElement("div"); l.className = "lab"; l.textContent = g.ch || "?"; b.append(l);
  const cf = document.createElement("div"); cf.className = "cf"; cf.textContent = g.deleted ? "removed" : g.manual ? "set by you" : g.ch ? Math.round(g.conf * 100) + "%" : "no label"; b.append(cf);
  const d = document.createElement("span"); d.className = "dot"; b.append(d);
  b.title = g.reason || ""; b.onclick = () => openEditor(g.sid);
  return b;
}
$("#tabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; S.filter = b.dataset.f; renderReview(); };

function drawOverlay() {
  const ph = S.photos[S.ovPhoto]; if (!ph) return;
  const tabs = $("#photoTabs"); tabs.replaceChildren();
  S.photos.forEach((p, i) => { if (!p) return; const b = document.createElement("button"); b.className = "btn" + (i === S.ovPhoto ? " primary" : ""); b.textContent = `Photo ${i + 1}`; b.onclick = () => { S.ovPhoto = i; drawOverlay(); }; tabs.append(b); });
  const cv = $("#overlay"); drawGray(cv, ph.view, null); const g = cv.getContext("2d"); S.ovBoxes = [];
  for (const v of S.views.glyphs) {
    if (v.photo !== S.ovPhoto) continue;
    const k = ph.view.k, x = v.x0 * k, y = v.y0 * k, w = v.w * k, h = v.h * k;
    g.lineWidth = 2; g.strokeStyle = v.deleted ? "#aaa" : v.flag ? "#d98a00" : v.used ? "#1c8a4a" : "#9aa"; g.strokeRect(x, y, w, h);
    S.ovBoxes.push({ sid: v.sid, x, y, w, h });
  }
}
$("#overlay").addEventListener("click", (e) => {
  const cv = e.currentTarget, r = cv.getBoundingClientRect(), sx = cv.width / r.width;
  const px = (e.clientX - r.left) * sx, py = (e.clientY - r.top) * sx;
  let best = null, bd = 1e9; for (const b of S.ovBoxes) { if (px >= b.x - 4 && px <= b.x + b.w + 4 && py >= b.y - 4 && py <= b.y + b.h + 4) { const d = Math.hypot(px - (b.x + b.w / 2), py - (b.y + b.h / 2)); if (d < bd) { bd = d; best = b; } } }
  if (best) openEditor(best.sid);
});
$("#addPhoto").onclick = () => { S.pendingAdd = true; showStep("upload"); };
$("#toFont").onclick = () => { showStep("font"); initFontStep(); };
$("#backReview").onclick = () => showStep("review");

/* ---------- glyph editor ---------- */
const ed = $("#editor");
function glyphById(sid) { return S.views.glyphs.find(g => g.sid === sid); }
function openEditor(sid) {
  S.edSid = sid; const g = glyphById(sid); if (!g) return;
  const cw = 360, chh = 260, { c, sc, ox, oy } = glyphCanvas(g, cw, chh, 4);
  const cv = $("#edCanvas"); cv.width = cw * 2; cv.height = chh * 2; const x = cv.getContext("2d"); x.drawImage(c, 0, 0, cw * 2, chh * 2);
  S.edGeom = { sc, ox, oy };
  $("#edChar").value = g.ch; $("#edInfo").textContent = g.deleted ? "This glyph is removed." : (g.manual ? "Label set by you." : g.ch ? `Match ${Math.round(g.conf * 100)}%.` + (g.reason ? " " + g.reason + "." : "") : "No label yet. Type the letter this shape is.") + (g.used ? " Used in your font." : "");
  const gs = $("#edGuess"); gs.hidden = !(g.top && g.top !== "?" && g.top !== g.ch); gs.textContent = g.top ? `It looks like "${g.top}"` : "";
  $("#edRestore").hidden = !g.deleted; $("#edDel").hidden = g.deleted;
  $("#edPin").disabled = !g.ch || g.deleted; $("#edPin").textContent = g.ch ? `Use this one for "${g.ch}"` : "Use this one";
  drawSplit(); if (!ed.open) ed.showModal();
}
function drawSplit() {
  const g = glyphById(S.edSid); if (!g) return; const f = $("#edSplit").value / 100, { sc, ox } = S.edGeom, cv = $("#edCanvas");
  openEditorBase(g);
  const x = cv.getContext("2d"); x.strokeStyle = "#c0392b"; x.lineWidth = 3; x.setLineDash([8, 6]); const sx = (ox + g.w * sc * f) * 2; x.beginPath(); x.moveTo(sx, 0); x.lineTo(sx, cv.height); x.stroke(); x.setLineDash([]);
}
function openEditorBase(g) { const cw = 360, chh = 260, { c } = glyphCanvas(g, cw, chh, 4); const cv = $("#edCanvas"); cv.getContext("2d").drawImage(c, 0, 0, cw * 2, chh * 2); }
$("#edSplit").oninput = drawSplit;
async function edOp(cmd, args) { S.views = await call(cmd, { sid: S.edSid, ...args }); renderReview(); }
async function reopen(sid) { renderReview(); if (glyphById(sid)) openEditor(sid); else ed.close(); }
$("#edChar").addEventListener("change", async () => { const v = [...$("#edChar").value.trim()][0]; if (!v) return; S.views = await call("relabel", { sid: S.edSid, ch: v }); reopen(S.edSid); });
$("#edGuess").onclick = async () => { const g = glyphById(S.edSid); S.views = await call("relabel", { sid: S.edSid, ch: g.top }); reopen(S.edSid); };
$("#edPin").onclick = async () => { S.views = await call("pin", { sid: S.edSid }); reopen(S.edSid); };
$("#edDel").onclick = async () => { S.views = await call("remove", { sid: S.edSid, value: true }); renderReview(); ed.close(); };
$("#edRestore").onclick = async () => { S.views = await call("remove", { sid: S.edSid, value: false }); reopen(S.edSid); };
$("#edSplitGo").onclick = async () => { S.views = await call("split", { sid: S.edSid, f: $("#edSplit").value / 100 }); renderReview(); ed.close(); };
$("#edMerge").onclick = async () => { S.views = await call("merge", { sid: S.edSid }); renderReview(); ed.close(); };

/* ---------- step 4: font ---------- */
const P = { track: $("#p_track"), sb: $("#p_sb"), sp: $("#p_sp"), sm: $("#p_sm"), th: $("#p_th") };
let fontInit = false;
function initFontStep() {
  if (!fontInit) { P.sp.value = S.views.autoSpace; $("#p_join").checked = S.views.cutFrac > 0.3; fontInit = true; }
  updateOutputs(); rebuild();
}
function updateOutputs() { $("#o_track").textContent = P.track.value; $("#o_sb").textContent = P.sb.value; $("#o_sp").textContent = P.sp.value; $("#o_sm").textContent = (+P.sm.value).toFixed(2); $("#o_th").textContent = (+P.th.value).toFixed(1); }
function params() { return { name: $("#fname").value.trim() || "My Handwriting", tracking: +P.track.value, sideBearing: +P.sb.value, spaceWidth: +P.sp.value, smooth: +P.sm.value, thickness: +P.th.value, joinCursive: $("#p_join").checked, fallback: $("#p_fb").checked }; }
let rebuildTimer = null;
function schedule() { updateOutputs(); clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 160); }
[...Object.values(P), $("#p_join"), $("#p_fb"), $("#fname")].forEach(el => el.addEventListener("input", schedule));
$("#ptext").addEventListener("input", applyPreviewText); $("#psize").addEventListener("input", applyPreviewText);
function applyPreviewText() { const pv = $("#preview"); pv.textContent = $("#ptext").value; pv.style.fontSize = $("#psize").value + "px"; }
async function rebuild() {
  const my = ++S.fontSeq;
  try {
    const r = await call("build", { params: params(), formats: ["ttf"] });
    if (my !== S.fontSeq) return;
    const fam = "hfm-preview-" + my, ff = new FontFace(fam, r.ttf.buffer.slice(r.ttf.byteOffset, r.ttf.byteOffset + r.ttf.byteLength));
    await ff.load(); document.fonts.add(ff);
    if (S.fontFace) document.fonts.delete(S.fontFace);
    S.fontFace = ff; S.fontFamily = fam; S.lastBuild = { missing: r.missing, glyphCount: r.glyphCount };
    const pv = $("#preview"); pv.style.fontFamily = `"${fam}", sans-serif`; applyPreviewText();
    pv.dataset.family = fam; pv.dataset.glyphs = r.glyphCount;
    const mn = $("#missingNote");
    mn.hidden = !r.missing.length; if (r.missing.length) mn.textContent = `Not in this font (${r.missing.length}): ${r.missing.join(" ")}. Text with these characters falls back to your system font.`;
    $("#dlInfo").textContent = `${r.glyphCount} glyphs, ${(r.ttf.byteLength / 1024).toFixed(0)} KB TTF.`;
    showError("");
  } catch (err) { showError("Could not build the font: " + err.message); }
}
async function download(fmt, mime, ext) {
  try {
    const r = await call("build", { params: params(), formats: [fmt] });
    const buf = r[fmt]; const blob = new Blob([buf], { type: mime });
    const name = (params().name.replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-") || "My-Handwriting") + "." + ext;
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    $("#dlInfo").textContent = `Downloaded ${name} (${(buf.byteLength / 1024).toFixed(0)} KB).`;
  } catch (err) { showError("Download failed: " + err.message); }
}
$("#dlTTF").onclick = () => download("ttf", "font/ttf", "ttf");
$("#dlOTF").onclick = () => download("otf", "font/otf", "otf");
$("#dlWOFF").onclick = () => download("woff", "font/woff", "woff");

/* ---------- offline ---------- */
if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !location.search.includes("nosw")) navigator.serviceWorker.register("sw.js").catch(() => {});
