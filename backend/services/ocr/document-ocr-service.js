/**
 * Document OCR Service v3.2
 *
 * Full OCR pipeline ported from the reference vendor-onboarding ExtractionService.
 * NO AWS Textract, NO OpenAI â deterministic OCR + rule-based parsers.
 *
 * Pipeline improvements over v1:
 *   - Multi-PSM OCR (PSM 6/11/3/4) with field-aware scoring
 *   - Sauvola adaptive binarization for PAN PDFs
 *   - Auto-rotation for sideways cheque images
 *   - Hindi OCR support for MSME & cheque documents
 *   - Combined text merge across all OCR passes
 *   - PDF text extraction with Y-coordinate grouping (preserves line breaks)
 *   - Cheque crop pass with overlap-aware tail extension for short account numbers
 */

// Shim canvas module before pdfjs-dist loads
require("./canvas-shim");

const Tesseract = require("tesseract.js");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");

// âââ OCR Debug logging (enable with OCR_DEBUG=1) ââââââââââââââââââââââââââââââ
const OCR_DEBUG = process.env.OCR_DEBUG === "1";
function ocrLog(label, info) {
  if (!OCR_DEBUG) return;
  console.log("[OCR_DEBUG]", JSON.stringify({
    label,
    docType: info.docType || "",
    source: info.source || "",
    variant: info.variant || "",
    textLen: (info.text || "").length,
    confidence: info.confidence || 0,
    first200: (info.text || "").substring(0, 200).replace(/\n/g, "\\n"),
  }));
}

// Field parsers (PAN / GST / MSME / cheque) ported from the client ExtractionService.
const {
  parseGSTData,
  parsePANData,
  parseMSMEData,
  parseChequeData,
} = require("./parsers.js");

// âââ Canvas helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function getCanvas() {
  return require("@napi-rs/canvas");
}

function makeCanvas(w, h) {
  const { createCanvas } = getCanvas();
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  return { canvas, ctx };
}

async function loadImageToCanvas(imagePath) {
  const { loadImage } = getCanvas();
  const img = await loadImage(imagePath);
  const { canvas, ctx } = makeCanvas(img.width, img.height);
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, width: img.width, height: img.height };
}

function canvasToBuffer(canvas) {
  return canvas.toBuffer("image/png");
}

function writeTempImage(buffer, basePath, suffix) {
  const ext = path.extname(basePath);
  const tempPath = basePath.replace(ext, `${suffix}.png`);
  fs.writeFileSync(tempPath, buffer);
  return tempPath;
}

function cleanupTemp(filePath) {
  try { fs.unlinkSync(filePath); } catch (_) {}
}

// âââ Sauvola adaptive binarization ââââââââââââââââââââââââââââââââââââââââââ
// Works on low-contrast images like teal PAN cards.
// For each pixel: threshold = local_mean * (1 + k * (local_std/R - 1))
// k=0.2, R=128 are standard Sauvola parameters.

function applySauvola(canvas, ctx, nWindow) {
  const nW = nWindow || 25;
  const w = canvas.width, h = canvas.height;
  const src = ctx.getImageData(0, 0, w, h).data;

  // Build grayscale float array
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2];
  }

  // Integral images for fast local mean and variance
  const intSum = new Float64Array((w + 1) * (h + 1));
  const intSq = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      const idx = (y + 1) * (w + 1) + (x + 1);
      intSum[idx] = v + intSum[y * (w + 1) + (x + 1)] + intSum[(y + 1) * (w + 1) + x] - intSum[y * (w + 1) + x];
      intSq[idx] = v * v + intSq[y * (w + 1) + (x + 1)] + intSq[(y + 1) * (w + 1) + x] - intSq[y * (w + 1) + x];
    }
  }

  const half = Math.floor(nW / 2);
  const k = 0.2, R = 128.0;
  const out = ctx.createImageData(w, h);
  const od = out.data;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x1 = Math.max(0, px - half), y1 = Math.max(0, py - half);
      const x2 = Math.min(w - 1, px + half), y2 = Math.min(h - 1, py + half);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      const sumV = intSum[(y2 + 1) * (w + 1) + (x2 + 1)] - intSum[y1 * (w + 1) + (x2 + 1)] - intSum[(y2 + 1) * (w + 1) + x1] + intSum[y1 * (w + 1) + x1];
      const sumSq = intSq[(y2 + 1) * (w + 1) + (x2 + 1)] - intSq[y1 * (w + 1) + (x2 + 1)] - intSq[(y2 + 1) * (w + 1) + x1] + intSq[y1 * (w + 1) + x1];

      const mean = sumV / count;
      const variance = sumSq / count - mean * mean;
      const std = variance > 0 ? Math.sqrt(variance) : 0;
      const thresh = mean * (1.0 + k * (std / R - 1.0));

      const pix = gray[py * w + px] < thresh ? 0 : 255;
      const oi = (py * w + px) * 4;
      od[oi] = od[oi + 1] = od[oi + 2] = pix; od[oi + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

// âââ Otsu binarization (kept for general image preprocessing) âââââââââââââââ

function applyOtsu(canvas, ctx, offset) {
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const grayValues = [];
  for (let i = 0; i < data.length; i += 4) {
    grayValues.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
  }

  const histogram = new Array(256).fill(0);
  for (const g of grayValues) histogram[g]++;
  const total = grayValues.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * histogram[i];

  let sumB = 0, wB = 0, maxVariance = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  // A negative offset lowers the threshold so faint ink (e.g. the pale orange /
  // teal embossed PAN number) survives binarization instead of bleaching out.
  threshold += offset || 0;
  let idx = 0;
  for (let i = 0; i < data.length; i += 4) {
    const val = grayValues[idx++] > threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = val;
  }
  ctx.putImageData(imageData, 0, 0);
}

// Trim a (binarized) canvas to the bounding box of its dark pixels plus a white
// margin. Tesseract's single-line modes hallucinate trailing characters when a
// short value sits in a wide field of whitespace â collapsing the canvas to just
// the ink (e.g. the 10-char PAN) is what makes the read reliable.
function trimToContent(canvas, padding) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4] < 128) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) { return canvas; }
  const pad = padding == null ? 12 : padding;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const { canvas: out, ctx: octx } = makeCanvas(cw, ch);
  octx.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return out;
}

// âââ Auto-rotation for sideways images ââââââââââââââââââââââââââââââââââââââ

function rotateCanvas(srcCanvas, deg) {
  const rad = deg * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const W = Math.ceil(srcCanvas.width * cos + srcCanvas.height * sin);
  const H = Math.ceil(srcCanvas.width * sin + srcCanvas.height * cos);
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(rad);
  ctx.drawImage(srcCanvas, -srcCanvas.width / 2, -srcCanvas.height / 2);
  return canvas;
}

// OCR-validated orientation detection for cheque photos.
//
// A phone photo of a cheque can be rotated by any multiple of 90Â°. The previous
// row-sharpness heuristic only chose between 90Â° and 270Â° and never considered
// 180Â°, so an upside-down capture (horizontal text lines in both 0Â° and 180Â°)
// was indistinguishable from upright â it routinely landed on the flipped
// orientation, where the IFSC/account OCR as reversed garbage (e.g. the real
// "512120020099009" comes back as "...82000080100"). Row density simply cannot
// tell upright text from text rotated 180Â°.
//
// Instead, OCR a downscaled copy at each of the four 90Â° orientations (PSM 6, so
// Tesseract reads the block as-is rather than silently auto-rotating) and keep
// the orientation whose text parses to a valid cheque. A structurally valid IFSC
// (BANK0XXXXXX) is the strongest signal â it scores far above a stray digit run â
// so the upright orientation wins decisively. Returns a rotated full-res temp
// path, or the original path when 0Â° already wins or detection fails.
async function autoRotateImage(imagePath) {
  try {
    const { canvas } = await loadImageToCanvas(imagePath);

    // Probe on a downscaled copy â orientation is recoverable at low resolution
    // and four full-res OCR passes would be needlessly slow.
    const probeMax = 1100;
    let best = { deg: 0, score: -1 };

    for (const deg of [0, 90, 180, 270]) {
      const rotated = deg === 0 ? canvas : rotateCanvas(canvas, deg);
      const ps = Math.min(1, probeMax / Math.max(rotated.width, rotated.height));
      const probe = ps < 1 ? scaleCanvas(rotated, ps) : rotated;
      const probePath = writeTempImage(canvasToBuffer(probe), imagePath, `_orient${deg}`);
      let score = 0;
      try {
        const { text, confidence } = await ocrImage(probePath, 6, false);
        const parsed = parseChequeData(text);
        if (parsed.ifscCode) { score += 1000; }
        if (parsed.accountNumber) { score += 200; }
        score += confidence || 0;
      } catch (_) {}
      cleanupTemp(probePath);
      ocrLog("autoRotate", { docType: "CANCELLED_CHEQUE", source: `deg=${deg}`, variant: `score=${score}` });
      if (score > best.score) { best = { deg, score }; }
    }

    // Only emit a rotated file when a non-zero orientation won and it actually
    // produced a usable read; otherwise leave the original image untouched.
    if (best.deg === 0 || best.score < 1) { return imagePath; }
    const rotatedPath = writeTempImage(canvasToBuffer(rotateCanvas(canvas, best.deg)), imagePath, "_rotated");
    return rotatedPath;
  } catch (_) {
    return imagePath;
  }
}

// âââ Tesseract OCR wrapper (pooled workers to reduce memory churn) ââââââââââ

// Cache workers by language key so we don't create/destroy per call.
const _workerCache = {};
const _workerLock = {};

async function getWorker(langs) {
  // Serialize creation per lang key to avoid duplicate concurrent inits
  while (_workerLock[langs]) {
    await _workerLock[langs];
  }
  if (_workerCache[langs]) return _workerCache[langs];
  let resolve;
  _workerLock[langs] = new Promise((r) => { resolve = r; });
  try {
    const w = await Tesseract.createWorker(langs);
    _workerCache[langs] = w;
    return w;
  } finally {
    delete _workerLock[langs];
    resolve();
  }
}

async function ocrImage(imagePath, psm, useHindi) {
  const langs = useHindi ? "eng+hin" : "eng";
  try {
    const worker = await getWorker(langs);
    await worker.setParameters({ tessedit_pageseg_mode: String(psm || 6) });
    const { data } = await worker.recognize(imagePath);
    const result = { text: (data && data.text) || "", confidence: (data && data.confidence) || 0 };
    ocrLog("ocrImage", { source: `psm=${psm}`, text: result.text, confidence: result.confidence });
    return result;
  } catch (err) {
    if (OCR_DEBUG) console.error("[OCR_DEBUG] ocrImage failed:", err.message, "path:", imagePath, "psm:", psm);
    // If the cached worker broke, discard it so next call creates a fresh one
    delete _workerCache[useHindi ? "eng+hin" : "eng"];
    return { text: "", confidence: 0 };
  }
}

// Recognize an image returning word-level bounding boxes (for label-anchored crops).
async function ocrWords(imagePath, psm) {
  try {
    const worker = await getWorker("eng");
    await worker.setParameters({ tessedit_pageseg_mode: String(psm || 6) });
    const { data } = await worker.recognize(imagePath, {}, { text: true, blocks: true });
    const words = [];
    (data.blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) => (p.lines || []).forEach((l) => (l.words || []).forEach((w) => {
      if (w && w.bbox) { words.push({ text: w.text || "", bbox: w.bbox }); }
    }))));
    return { text: (data && data.text) || "", words };
  } catch (_) {
    delete _workerCache["eng"];
    return { text: "", words: [] };
  }
}

// OCR a single text line with an alphanumeric whitelist (PSM 7).
async function ocrLineAlnum(imagePath) {
  try {
    const worker = await getWorker("eng");
    await worker.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
    const { data } = await worker.recognize(imagePath);
    return (data && data.text) || "";
  } catch (_) {
    delete _workerCache["eng"];
    return "";
  }
}

// Crop a rectangle from the card, magnify + mild-contrast it, and OCR it as a
// single alphanumeric line. Returns the structurally valid PAN it reads, or null.
async function cropReadPan(cardCanvas, x, y, w, h, basePath, tempFiles) {
  const cw = cardCanvas.width, ch = cardCanvas.height;
  const sx = Math.max(0, Math.round(x)), sy = Math.max(0, Math.round(y));
  const sw = Math.min(cw - sx, Math.round(w)), sh = Math.min(ch - sy, Math.round(h));
  if (sw < 10 || sh < 6) { return []; }
  // Magnify the value strip so the 10 glyphs are large enough to resolve.
  const ef = Math.max(4, Math.min(12, 150 / sh));
  const { canvas: base, ctx: bctx } = makeCanvas(Math.round(sw * ef), Math.round(sh * ef));
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(cardCanvas, sx, sy, sw, sh, 0, 0, base.width, base.height);

  // The PAN prints in faint blue / orange ink whose exact tone varies by scan,
  // so no single threshold reads every card. Run a spread of preprocessors,
  // trim each to its ink, and let every structurally-valid read vote â the true
  // number recurs across variants while per-variant glyph errors scatter.
  const variants = [
    ["stretch", (c, x) => stretchContrastGray(c, x)],
    ["otsu", (c, x) => applyOtsu(c, x, 0)],
    ["otsu-30", (c, x) => applyOtsu(c, x, -30)],
    ["sauvola", (c, x) => applySauvola(c, x, 15)],
    ["mild", (c, x) => mildContrastGray(c, x, 3)],
  ];
  const pans = [];
  for (const [name, prep] of variants) {
    const { canvas: v, ctx: vctx } = makeCanvas(base.width, base.height);
    vctx.drawImage(base, 0, 0);
    prep(v, vctx);
    const trimmed = trimToContent(v, 12);
    const stripPath = writeTempImage(canvasToBuffer(trimmed), basePath, "_panstrip_" + name);
    tempFiles.push(stripPath);
    const text = await ocrLineAlnum(stripPath);
    const pan = parsePANData("PERMANENT ACCOUNT NUMBER " + text).panNumber;
    if (pan) { pans.push(pan); }
  }
  return pans;
}

// PAN-card number recovery. The whole-card OCR scrambles the faint number, so we
// isolate just the value and re-read it magnified. Two complementary anchors:
//  (a) the PAN sits below the "ACCOUNT NUMBER" label â crop the strip beneath it;
//  (b) the first-pass word boxes often contain a PAN-shaped token already â crop
//      that token's own box and re-read it.
// Every read votes; the most frequent structurally valid PAN wins, so one misread
// crop can't beat the true value that recurs across crops.
async function extractPanByLabel(cardCanvas, basePath, tempFiles, votes, weight) {
  votes = votes || {};
  const wgt = weight || 1;
  const { canvas: mc, ctx: mctx } = makeCanvas(cardCanvas.width, cardCanvas.height);
  mctx.drawImage(cardCanvas, 0, 0);
  mildContrastGray(mc, mctx, 2);
  const mcPath = writeTempImage(canvasToBuffer(mc), basePath, "_panlabel");
  tempFiles.push(mcPath);
  const { words } = await ocrWords(mcPath, 6);
  // Match loosely â on faint cards the label words OCR as truncated/garbled
  // fragments ("Numbe", "Accoun"), but a partial hit still locates the line.
  const num = words.find((w) => /NUMB/i.test(w.text));
  const acc = words.find((w) => /ACCOU/i.test(w.text));

  const tally = async (region) => {
    const pans = await cropReadPan(cardCanvas, region.x, region.y, region.w, region.h, basePath, tempFiles);
    for (const p of pans) { votes[p] = (votes[p] || 0) + wgt; }
  };

  // (b) Re-read any PAN-shaped word box (a token that already coerces to a valid
  // PAN â even with a misread digit â marks where the number is on the card).
  const panWords = words.filter((w) => {
    const c = (w.text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 10 || c.length > 12) { return false; }
    for (let k = 0; k <= c.length - 10; k++) { if (parsePANData("X " + c.substr(k, 10)).panNumber) { return true; } }
    return false;
  });
  for (const w of panWords) {
    const bw = w.bbox.x1 - w.bbox.x0, bh = w.bbox.y1 - w.bbox.y0;
    await tally({ x: w.bbox.x0 - bw * 0.12, y: w.bbox.y0 - bh * 0.4, w: bw * 1.24, h: bh * 1.8 });
  }

  // (a) Strip beneath the "ACCOUNT NUMBER" label, swept over a few offsets.
  // Anchor off whichever of the label's two words was found. The value prints
  // on the next line down, left-aligned under "Permanent" â i.e. starting well
  // to the LEFT of the "Account" word â so the crop reaches generously leftward
  // and trimToContent collapses it back onto the actual digits.
  const anchor = (num && num.bbox) ? num : ((acc && acc.bbox) ? acc : null);
  if (anchor) {
    const lineH = Math.max(8, anchor.bbox.y1 - anchor.bbox.y0);
    const leftRef = (acc && acc.bbox) ? acc.bbox.x0 : anchor.bbox.x0;
    const rightRef = (num && num.bbox) ? num.bbox.x1 : anchor.bbox.x1;
    const labW = Math.max(20, rightRef - leftRef);
    const sx = Math.max(0, Math.round(leftRef - labW * 1.6));
    const sw = Math.round(labW * 3.2);
    for (const yoff of [0.0, 0.3, 0.6, 0.9]) {
      await tally({ x: sx, y: anchor.bbox.y1 + lineH * yoff, w: sw, h: lineH * 2.2 });
    }
  }

  let bestPan = null, bestVotes = 0;
  for (const p of Object.keys(votes)) { if (votes[p] > bestVotes) { bestPan = p; bestVotes = votes[p]; } }
  return bestPan;
}

// âââ Parser dispatcher âââââââââââââââââââââââââââââââââââââââââââââââââââââ

function parseByType(rawText, docType) {
  const type = String(docType || "").toUpperCase();
  switch (type) {
    case "GST": return parseGSTData(rawText);
    case "PAN": return parsePANData(rawText);
    case "MSME": return parseMSMEData(rawText);
    case "CANCELLED_CHEQUE": return parseChequeData(rawText);
    default: return {};
  }
}

// Return the list of expected field names for a doc type
function expectedFields(docType) {
  const type = String(docType || "").toUpperCase();
  switch (type) {
    case "GST": return ["gstin", "legalName", "tradeName", "address", "state", "district", "pincode"];
    case "PAN": return ["panNumber", "name", "fatherName", "dateOfBirth"];
    case "MSME": return ["udyamRegistrationNumber", "enterpriseName", "enterpriseType", "registrationDate", "houseNo", "building", "villageTown", "block", "roadStreet", "city", "district", "state", "pincode", "address"];
    case "CANCELLED_CHEQUE": return ["ifscCode", "accountNumber"];
    default: return [];
  }
}

// Score a parse result: found fields * 100 - missing * 50
function scoreResult(parsed, docType) {
  const fields = expectedFields(docType);
  let found = 0, missing = 0;
  for (const f of fields) {
    if (f === "rawText") continue;
    if (parsed[f]) found++;
    else missing++;
  }
  return found * 100 - missing * 50;
}

// Check if result has missing required fields
function hasMissing(parsed, docType) {
  const fields = expectedFields(docType);
  const primaryFields = getPrimaryFields(docType);
  for (const f of primaryFields) {
    if (!parsed[f]) return true;
  }
  return false;
}

// Primary fields that must be found for a "complete" extraction
function getPrimaryFields(docType) {
  const type = String(docType || "").toUpperCase();
  switch (type) {
    case "GST": return ["gstin", "legalName"];
    case "PAN": return ["panNumber", "name"];
    case "MSME": return ["udyamRegistrationNumber", "enterpriseName"];
    case "CANCELLED_CHEQUE": return ["ifscCode", "accountNumber"];
    default: return [];
  }
}

// âââ Multi-PSM OCR pipeline with field-aware scoring ââââââââââââââââââââââââ

async function runOcrPass(imagePath, docType, psm, useHindi) {
  const { text, confidence } = await ocrImage(imagePath, psm, useHindi);
  const parsed = parseByType(text, docType);
  const score = scoreResult(parsed, docType) + confidence;
  ocrLog("runOcrPass", { docType, source: `psm=${psm}`, text, confidence, variant: `score=${score}` });
  return { text, confidence, parsed, score };
}

/**
 * Run multi-PSM OCR pipeline on an image.
 * Returns { best, allText } where best has { text, confidence, parsed, score }
 * and allText is the concatenation of all pass texts.
 */
async function multiPsmOcr(imagePath, docType, useHindi) {
  let best = { text: "", confidence: 0, parsed: {}, score: -9999 };
  let allText = "";

  function keep(result) {
    allText += "\n" + (result.text || "");
    if (result.score > best.score) { best = result; }
  }

  function done() {
    return !hasMissing(best.parsed, docType) && best.confidence >= 50;
  }

  // PSM 6 + PSM 11 in parallel (biggest latency win)
  const [r6, r11] = await Promise.all([
    runOcrPass(imagePath, docType, 6, useHindi),
    runOcrPass(imagePath, docType, 11, useHindi),
  ]);
  keep(r6);
  keep(r11);
  if (done()) return { best, allText };

  // PSM 3: Fully automatic page segmentation
  const r3 = await runOcrPass(imagePath, docType, 3, useHindi);
  keep(r3);
  if (done()) return { best, allText };

  // PSM 4: Single column of text
  const r4 = await runOcrPass(imagePath, docType, 4, useHindi);
  keep(r4);

  return { best, allText };
}

// âââ Combined text merge ââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Merge fields from combined-text parse into best result, filling gaps.
// Special handling for accountNumber: only accept longer value where existing
// is a prefix (prevents noise overwrite).

function mergeCombinedResult(bestParsed, combinedParsed, docType) {
  const merged = { ...bestParsed };
  const fields = expectedFields(docType);
  const type = String(docType || "").toUpperCase();

  for (const f of fields) {
    if (f === "rawText") continue;
    const incoming = combinedParsed[f];
    const existing = merged[f];

    if (type === "CANCELLED_CHEQUE" && f === "accountNumber") {
      // Only accept longer account number where existing is a prefix
      if (incoming && existing) {
        if (incoming.length > existing.length && incoming.indexOf(existing) === 0) {
          merged[f] = incoming;
        }
      } else if (!existing && incoming) {
        merged[f] = incoming;
      }
    } else {
      // Fill missing fields from combined text
      if (!existing && incoming) {
        merged[f] = incoming;
      }
    }
  }
  return merged;
}

// âââ PDF text extraction with Y-coordinate grouping âââââââââââââââââââââââââ
// Groups text items by Y-coordinate to preserve line breaks.
// Critical for MSME State/District extraction which relies on per-line matching.

async function extractPdfTextWithLineBreaks(buffer) {
  const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

  const pageTexts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = [];
    let currentLine = [];
    let lastY = null;

    for (const item of content.items) {
      const y = item.transform ? Math.round(item.transform[5]) : 0;
      if (lastY === null || Math.abs(y - lastY) > 3) {
        if (currentLine.length) { lines.push(currentLine.join(" ")); }
        currentLine = [item.str];
        lastY = y;
      } else {
        currentLine.push(item.str);
      }
    }
    if (currentLine.length) { lines.push(currentLine.join(" ")); }
    pageTexts.push(lines.join("\n"));
  }
  return pageTexts.join("\n");
}

// âââ Image preprocessing (Otsu) âââââââââââââââââââââââââââââââââââââââââââââ

async function preprocessImageOtsu(imagePath) {
  try {
    const { canvas, ctx } = await loadImageToCanvas(imagePath);
    applyOtsu(canvas, ctx);
    const tempPath = writeTempImage(canvasToBuffer(canvas), imagePath, "_preprocessed");
    return tempPath;
  } catch (_) {
    return null;
  }
}

// âââ Image preprocessing (Sauvola) ââââââââââââââââââââââââââââââââââââââââââ

async function preprocessImageSauvola(imagePath) {
  try {
    const { canvas, ctx } = await loadImageToCanvas(imagePath);
    applySauvola(canvas, ctx, 25);
    const tempPath = writeTempImage(canvasToBuffer(canvas), imagePath, "_sauvola");
    return tempPath;
  } catch (_) {
    return null;
  }
}

// âââ Crop-to-content + contrast enhancement (for small cards on white pages) â
// A scanned PAN/ID card typically sits as a small region inside a large, mostly
// white page. OCR'ing the whole page leaves the card text tiny and faint, so
// Tesseract latches onto the card's ghost-photo / watermark background and
// returns garbage. We locate the card's bounding box, crop to it, upscale, and
// stretch contrast so the real (often pale teal) text becomes readable.

// Find the bounding box of the dominant content block, ignoring scanner dust.
function findContentBBox(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  // Downscale for speed and to suppress isolated speckle noise.
  const SW = Math.min(w, 500);
  const scale = SW / w;
  const SH = Math.max(1, Math.round(h * scale));
  const { canvas: tc, ctx: tctx } = makeCanvas(SW, SH);
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(srcCanvas, 0, 0, SW, SH);
  const d = tctx.getImageData(0, 0, SW, SH).data;

  const rowInk = new Float32Array(SH);
  const colInk = new Float32Array(SW);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      // "Ink" = anything noticeably darker than white OR coloured (teal card).
      if (lum < 215 || sat > 30) { rowInk[y]++; colInk[x]++; }
    }
  }

  let maxRow = 0, maxCol = 0;
  for (let y = 0; y < SH; y++) if (rowInk[y] > maxRow) maxRow = rowInk[y];
  for (let x = 0; x < SW; x++) if (colInk[x] > maxCol) maxCol = colInk[x];
  if (maxRow < 4 || maxCol < 4) return null; // essentially blank page

  // Keep rows/cols whose ink density is a meaningful fraction of the densest
  // line. The card border/text spans many pixels; dust contributes 1-2.
  const rowThr = Math.max(2, maxRow * 0.08);
  const colThr = Math.max(2, maxCol * 0.08);
  let y1 = -1, y2 = -1, x1 = -1, x2 = -1;
  for (let y = 0; y < SH; y++) if (rowInk[y] >= rowThr) { if (y1 < 0) y1 = y; y2 = y; }
  for (let x = 0; x < SW; x++) if (colInk[x] >= colThr) { if (x1 < 0) x1 = x; x2 = x; }
  if (y1 < 0 || x1 < 0) return null;

  // Map back to full resolution and pad slightly.
  const cw = (x2 - x1 + 1) / scale, ch = (y2 - y1 + 1) / scale;
  const padX = cw * 0.05, padY = ch * 0.06;
  const fx1 = Math.max(0, Math.round(x1 / scale - padX));
  const fy1 = Math.max(0, Math.round(y1 / scale - padY));
  const fx2 = Math.min(w, Math.round((x2 + 1) / scale + padX));
  const fy2 = Math.min(h, Math.round((y2 + 1) / scale + padY));
  return { x: fx1, y: fy1, w: fx2 - fx1, h: fy2 - fy1 };
}

// Plain high-quality rescale of the whole canvas by a factor (no cropping).
function scaleCanvas(srcCanvas, factor) {
  const dw = Math.max(1, Math.round(srcCanvas.width * factor));
  const dh = Math.max(1, Math.round(srcCanvas.height * factor));
  const { canvas, ctx } = makeCanvas(dw, dh);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas, 0, 0, dw, dh);
  return canvas;
}

// Crop the rendered page to its content and upscale to a comfortable OCR size.
function cropAndUpscaleCanvas(srcCanvas, targetWidth) {
  let region = findContentBBox(srcCanvas);
  // Fall back to the whole page if no sensible region was found, or the region
  // already fills most of the page (nothing to gain from cropping).
  if (!region || region.w < 60 || region.h < 40 ||
      (region.w > srcCanvas.width * 0.9 && region.h > srcCanvas.height * 0.9)) {
    region = { x: 0, y: 0, w: srcCanvas.width, h: srcCanvas.height };
  }
  const target = targetWidth || 1800;
  const scale = Math.max(1, target / region.w);
  const dw = Math.round(region.w * scale), dh = Math.round(region.h * scale);
  const { canvas, ctx } = makeCanvas(dw, dh);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas, region.x, region.y, region.w, region.h, 0, 0, dw, dh);
  return canvas;
}

// Grayscale + mild linear contrast around mid-grey. Gentler than the percentile
// stretch: on very faint blue/grey photocopies (e.g. scanned PAN cards) the
// percentile stretch crushes the faint ink into the background and Tesseract
// misreads it, whereas a mild gain keeps the strokes legible.
function mildContrastGray(canvas, ctx, gain) {
  const g = gain || 2;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    v = (v - 150) * g + 120;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

// Grayscale + percentile contrast stretch. Brings faint teal/grey text up to
// near-black against white without the speckle a hard binarization produces.
function stretchContrastGray(canvas, ctx) {
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    gray[p] = g; hist[g]++;
  }
  const pct = (frac) => {
    let target = n * frac, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
    return 255;
  };
  const lo = pct(0.03), hi = pct(0.97);
  const range = Math.max(1, hi - lo);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let v = ((gray[p] - lo) / range) * 255;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

// âââ Try to extract an embedded JPEG directly from PDF bytes ââââââââââââââââ

async function tryExtractEmbeddedImage(buffer, pdfPath) {
  try {
    let startIdx = -1;
    for (let i = 0; i < buffer.length - 2; i++) {
      if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8 && buffer[i + 2] === 0xFF) {
        startIdx = i;
        break;
      }
    }

    if (startIdx >= 0) {
      let endIdx = -1;
      for (let i = buffer.length - 2; i >= startIdx; i--) {
        if (buffer[i] === 0xFF && buffer[i + 1] === 0xD9) {
          endIdx = i + 2;
          break;
        }
      }

      if (endIdx > startIdx) {
        const jpegBuf = buffer.slice(startIdx, endIdx);
        const tempPath = pdfPath.replace(/\.pdf$/i, "_embedded.jpg");
        fs.writeFileSync(tempPath, jpegBuf);
        try {
          return tempPath;
        } catch (_) {
          cleanupTemp(tempPath);
        }
      }
    }
  } catch (_) {}
  return null;
}

// âââ Render PDF page to image âââââââââââââââââââââââââââââââââââââââââââââââ

async function renderPdfPageToImage(buffer, pdfPath, pageNum, scale) {
  const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale: scale || 5 });
  const { canvas, ctx } = makeCanvas(viewport.width, viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const tempPath = pdfPath.replace(/\.pdf$/i, `_page${pageNum}_s${String(scale || 5).replace(".", "_")}.png`);
  fs.writeFileSync(tempPath, canvasToBuffer(canvas));
  return { tempPath, numPages: doc.numPages, canvas };
}

// âââ Cheque crop pass for short account numbers âââââââââââââââââââââââââââââ
// When account number is < 14 digits, crop the cheque image region (x: 7-55%,
// y: 30-60%) and use overlap-aware tail extension to merge.

async function chequeCropPass(imagePath, existingAcct, existingIfsc, docType, useHindi) {

  try {
    const { canvas, width, height } = await loadImageToCanvas(imagePath);
    const cx1 = Math.round(width * 0.07), cy1 = Math.round(height * 0.30);
    const cx2 = Math.round(width * 0.55), cy2 = Math.round(height * 0.60);
    const cropW = cx2 - cx1, cropH = cy2 - cy1;
    const { canvas: cropCanvas, ctx: cropCtx } = makeCanvas(cropW, cropH);
    cropCtx.drawImage(canvas, cx1, cy1, cropW, cropH, 0, 0, cropW, cropH);

    const cropPath = writeTempImage(canvasToBuffer(cropCanvas), imagePath, "_crop");
    try {
      const { text: cropText } = await ocrImage(cropPath, 6, useHindi);

      // Strip "VALID FOR Rs. X.XX Lacs & UNDER" watermark from crop text
      const cleanedCropText = (cropText || "").replace(/VALID\s+FOR\b[^\n]*/gi, "");

      // Collect ALL digit runs from cleaned crop text as candidates
      const cropRawRuns = cleanedCropText.match(/\d{8,18}/g) || [];
      const cropParsed = parseByType(cleanedCropText, docType);
      if (cropParsed.accountNumber) { cropRawRuns.unshift(cropParsed.accountNumber); }

      // Find the longest common prefix between existingAcct and each crop candidate,
      // then compute the net-new tail digits the crop found beyond the overlap.
      let bestExtended = null;
      let bestExtLen = 0;

      for (const cropNum of cropRawRuns) {
        if (!cropNum) continue;

        // Find longest prefix of existingAcct that appears in cropNum
        let overlapLen = 0;
        for (let pl = Math.min(existingAcct.length, cropNum.length); pl >= 6; pl--) {
          if (cropNum.indexOf(existingAcct.substring(0, pl)) === 0) {
            overlapLen = pl;
            break;
          }
        }

        if (overlapLen < 6) continue; // No meaningful overlap

        // Net-new digits: crop chars after the overlap point
        const netNewTail = cropNum.substring(overlapLen);
        const knownTail = existingAcct.substring(overlapLen);
        // Truly new digits are those beyond the known tail length
        const trulyNew = netNewTail.substring(knownTail.length);

        if (trulyNew.length > 0 && trulyNew.length <= 4) {
          const extended = existingAcct + trulyNew;
          if (extended.length >= 9 && extended.length <= 18 && extended.length > bestExtLen) {
            bestExtended = extended;
            bestExtLen = extended.length;
          }
        }
      }

      return {
        extendedAcct: bestExtended,
        cropIfsc: cropParsed.ifscCode || null,
        cropText: cropText || "",
      };
    } finally {
      cleanupTemp(cropPath);
    }
  } catch (_) {
    return null;
  }
}

// âââ Main scan pipeline for GST/PAN/MSME/Cheque ââââââââââââââââââââââââââââ

async function scanDocumentWithMultiPass(filePath, docType) {
  const type = String(docType || "").toUpperCase();
  const isPdf = path.extname(filePath).toLowerCase() === ".pdf";
  const useHindi = type === "MSME" || type === "CANCELLED_CHEQUE";

  // ââ PAN PDF: Sauvola binarization pipeline ââ
  if (type === "PAN" && isPdf) {
    return await scanPanPdf(filePath, type);
  }

  // ââ PDF documents: extract embedded text first ââ
  if (isPdf) {
    return await scanPdfDocument(filePath, type, useHindi);
  }

  // ââ Image documents ââ
  return await scanImageDocument(filePath, type, useHindi);
}

async function scanPanPdf(filePath, docType) {
  const buffer = await fsp.readFile(filePath);

  // âââ PHASE 1: TEXT EXTRACTION âââ
  // Capture pdf-parse text but always continue to OCR for complete rawText
  let pdfParseText = "";
  try {
    const data = await pdfParse(buffer);
    if (data.text && data.text.trim().length > 10) {
      pdfParseText = data.text;
      ocrLog("scanPanPdf", { docType, source: "pdf-parse", text: pdfParseText });
    }
  } catch (_) {}

  // Render page 1, then crop to the card region and upscale it so the (usually
  // small, faint) card text is large enough for OCR. Without this, OCR sees a
  // tiny card on a big white page and reads the card's ghost-photo background.
  const { tempPath } = await renderPdfPageToImage(buffer, filePath, 1, 5);
  let best = { text: "", confidence: 0, parsed: {}, score: -9999 };
  let allText = "";
  const tempFiles = [tempPath];

  // Seed best/allText with pdf-parse text if available
  if (pdfParseText) {
    const parsed = parseByType(pdfParseText, docType);
    const score = scoreResult(parsed, docType) + 95;
    best = { text: pdfParseText, confidence: 95, parsed, score };
    allText = pdfParseText + "\n";
  }

  function keep(result) {
    allText += "\n" + (result.text || "");
    if (result.score > best.score) { best = result; }
  }
  function done() {
    return !hasMissing(best.parsed, docType) && best.confidence >= 50;
  }

  try {
    const { canvas: pageCanvas } = await loadImageToCanvas(tempPath);
    const cardCanvas = cropAndUpscaleCanvas(pageCanvas, 1800);
    const cardPath = writeTempImage(canvasToBuffer(cardCanvas), tempPath, "_card");
    tempFiles.push(cardPath);

    // Label-anchored PAN: crop the value strip beneath "ACCOUNT NUMBER" and read
    // it alone. Far more reliable on faint photocopies than whole-card OCR, so it
    // overrides the multi-pass PAN when it succeeds. Run on a near-native (scale 3)
    // render â the scale-5 page upscales the embedded scan into blur, which the
    // strip's extra magnification would amplify into misread digits.
    let stripPan = null;
    try {
      // Accumulate label-anchored reads across several render scales and a
      // cropped-card view of each. No single scale reads every faint card: at low
      // DPI the digits blur (6829â5821), at high DPI the scan over-magnifies into
      // noise. The true number recurs across scales while per-scale misreads
      // scatter, so majority voting across scales recovers it.
      const panVotes = {};
      // Weight each scale's votes by the scale: a higher render gives the faint
      // digits more real pixels, so its reads are more trustworthy and break ties
      // against the blurrier low-DPI reads (e.g. 6829 over the low-res 5821).
      for (const scale of [3, 4, 5]) {
        const render = await renderPdfPageToImage(buffer, filePath, 1, scale);
        tempFiles.push(render.tempPath);
        await extractPanByLabel(render.canvas, render.tempPath, tempFiles, panVotes, scale);
        const card = cropAndUpscaleCanvas(render.canvas, 1700);
        await extractPanByLabel(card, render.tempPath, tempFiles, panVotes, scale);
      }
      let bestVotes = 0;
      for (const p of Object.keys(panVotes)) { if (panVotes[p] > bestVotes) { stripPan = p; bestVotes = panVotes[p]; } }
    } catch (_) { stripPan = null; }
    const fin = (b, a) => {
      const res = finalize(b, a, docType);
      if (stripPan) { res.panNumber = stripPan; }
      return res;
    };

    // Variant 0 â mild linear contrast. On very faint photocopies the percentile
    // stretch (Variant A) over-darkens and the PAN misreads; a gentle gain keeps
    // the strokes legible. Tried first so a clean read can short-circuit.
    {
      const { canvas, ctx } = await loadImageToCanvas(cardPath);
      mildContrastGray(canvas, ctx, 2);
      const mildPath = writeTempImage(canvasToBuffer(canvas), tempPath, "_cardmild");
      tempFiles.push(mildPath);
      for (const psm of [6, 4, 3]) {
        keep(await runOcrPass(mildPath, docType, psm, false));
        if (done()) return fin(best, allText);
      }
    }

    // Variant A â contrast-stretched grayscale. Best for pale teal text; keeps
    // strokes intact where a hard threshold would shred them.
    {
      const { canvas, ctx } = await loadImageToCanvas(cardPath);
      stretchContrastGray(canvas, ctx);
      const grayPath = writeTempImage(canvasToBuffer(canvas), tempPath, "_cardgray");
      tempFiles.push(grayPath);
      for (const psm of [6, 4, 3, 11]) {
        keep(await runOcrPass(grayPath, docType, psm, false));
        if (done()) return fin(best, allText);
      }
    }

    // Variant B â Sauvola adaptive binarization of the cropped card.
    {
      const sauvolaPath = await preprocessImageSauvola(cardPath);
      if (sauvolaPath) {
        tempFiles.push(sauvolaPath);
        for (const psm of [6, 3, 11]) {
          keep(await runOcrPass(sauvolaPath, docType, psm, false));
          if (done()) return fin(best, allText);
        }
      }
    }

    // Variant C â Otsu global threshold of the cropped card.
    {
      const otsuPath = await preprocessImageOtsu(cardPath);
      if (otsuPath) {
        tempFiles.push(otsuPath);
        keep(await runOcrPass(otsuPath, docType, 6, false));
        if (done()) return fin(best, allText);
      }
    }

    // Fallback: OCR the cropped card with no binarization at all.
    keep(await runOcrPass(cardPath, docType, 6, false));

    // Last resort: embedded PDF text layer with Y-coordinate grouping.
    try {
      const pdfText = await extractPdfTextWithLineBreaks(buffer);
      if (pdfText && pdfText.length > 50) {
        const pdfParsed = parseByType(pdfText, docType);
        const pdfScore = scoreResult(pdfParsed, docType) + 95;
        if (pdfScore > best.score) {
          best = { text: pdfText, confidence: 95, parsed: pdfParsed, score: pdfScore };
        }
        allText = pdfText + "\n" + allText;
      }
    } catch (_) {}

    return fin(best, allText);
  } finally {
    for (const f of tempFiles) { cleanupTemp(f); }
  }
}

async function scanPdfDocument(filePath, docType, useHindi) {
  const buffer = await fsp.readFile(filePath);

  // âââ PHASE 1: TEXT EXTRACTION âââ
  // Collect text from every source (pdf-parse, pdfjs, OCR passes).
  let pdfParseText = "";
  try {
    const data = await pdfParse(buffer);
    if (data.text && data.text.trim().length > 10) {
      pdfParseText = data.text;
      ocrLog("scanPdfDocument", { docType, source: "pdf-parse", text: pdfParseText });
    }
  } catch (_) {}

  let best = { text: "", confidence: 0, parsed: {}, score: -9999 };
  let allText = "";
  const tempFiles = [];

  // Seed best/allText with pdf-parse text if available
  if (pdfParseText) {
    const parsed = parseByType(pdfParseText, docType);
    const score = scoreResult(parsed, docType) + 95;
    best = { text: pdfParseText, confidence: 95, parsed, score };
    allText = pdfParseText + "\n";
  }

  function keep(result) {
    allText += "\n" + (result.text || "");
    if (result.score > best.score) { best = result; }
  }

  // Render page 1 and run multi-PSM OCR
  const { tempPath, numPages } = await renderPdfPageToImage(buffer, filePath, 1, 5);
  tempFiles.push(tempPath);

  try {
    const { best: ocrBest, allText: ocrAllText } = await multiPsmOcr(tempPath, docType, useHindi);
    if (ocrBest.score > best.score) { best = ocrBest; }
    allText += "\n" + ocrAllText;

    // Try embedded JPEG extraction
    const embeddedPath = await tryExtractEmbeddedImage(buffer, filePath);
    if (embeddedPath) {
      tempFiles.push(embeddedPath);
      const embResult = await runOcrPass(embeddedPath, docType, 6, useHindi);
      keep(embResult);
    }

    // Try PDF embedded text with Y-coordinate grouping
    try {
      const pdfText = await extractPdfTextWithLineBreaks(buffer);
      if (pdfText && pdfText.length > 50) {
        const pdfParsed = parseByType(pdfText, docType);
        const pdfScore = scoreResult(pdfParsed, docType) + 95;
        if (pdfScore > best.score) {
          best = { text: pdfText, confidence: 95, parsed: pdfParsed, score: pdfScore };
        }
        allText = pdfText + "\n" + allText;
      }
    } catch (_) {}

    // PDF pages 2-4 if still missing
    if (hasMissing(best.parsed, docType) && numPages >= 2) {
      for (let pg = 2; pg <= Math.min(numPages, 4); pg++) {
        if (!hasMissing(best.parsed, docType)) break;
        try {
          const { tempPath: pgPath } = await renderPdfPageToImage(buffer, filePath, pg, 3);
          tempFiles.push(pgPath);
          const pgResult = await runOcrPass(pgPath, docType, 6, useHindi);
          keep(pgResult);
        } catch (_) {}
      }
    }

    return finalize(best, allText, docType);
  } finally {
    for (const f of tempFiles) { cleanupTemp(f); }
  }
}

async function scanImageDocument(filePath, docType, useHindi) {
  const type = String(docType || "").toUpperCase();
  let imagePath = filePath;
  const tempFiles = [];

  try {
    // Auto-rotate for cheque images
    if (type === "CANCELLED_CHEQUE") {
      const rotatedPath = await autoRotateImage(filePath);
      if (rotatedPath !== filePath) {
        imagePath = rotatedPath;
        tempFiles.push(rotatedPath);
      }
    }

    // Run multi-PSM OCR
    const { best, allText } = await multiPsmOcr(imagePath, docType, useHindi);

    // Also try Otsu-binarized version
    const otsuPath = await preprocessImageOtsu(imagePath);
    let bestResult = best;
    let combinedText = allText;

    if (otsuPath) {
      tempFiles.push(otsuPath);
      const otsuResult = await runOcrPass(otsuPath, docType, 6, useHindi);
      combinedText += "\n" + (otsuResult.text || "");
      if (otsuResult.score > bestResult.score) {
        bestResult = otsuResult;
      }
    }

    // Cheque images: the Hindi OCR model often garbles the IFSC / account number
    // printed in English.  Run additional English-only passes with contrast
    // enhancement so the key alphanumeric data is readable.
    if (type === "CANCELLED_CHEQUE" && hasMissing(bestResult.parsed, docType)) {
      try {
        // English-only multi-PSM on the original image
        for (const psm of [6, 3, 4]) {
          const r = await runOcrPass(imagePath, docType, psm, false);
          combinedText += "\n" + (r.text || "");
          if (r.score > bestResult.score) { bestResult = r; }
          if (!hasMissing(bestResult.parsed, docType) && bestResult.confidence >= 50) break;
        }
      } catch (_) {}
    }

    // Cheque images: upscale + contrast-stretch for faded/small cheques
    if (type === "CANCELLED_CHEQUE" && hasMissing(bestResult.parsed, docType)) {
      try {
        const { canvas: chqCanvas, width: chqW } = await loadImageToCanvas(imagePath);
        const chqFactor = Math.min(3, Math.max(1, 2000 / chqW));
        if (chqFactor > 1.1) {
          const upChq = scaleCanvas(chqCanvas, chqFactor);
          const upChqPath = writeTempImage(canvasToBuffer(upChq), imagePath, "_cheque_up");
          tempFiles.push(upChqPath);
          for (const psm of [6, 3]) {
            const r = await runOcrPass(upChqPath, docType, psm, false);
            combinedText += "\n" + (r.text || "");
            if (r.score > bestResult.score) { bestResult = r; }
            if (!hasMissing(bestResult.parsed, docType) && bestResult.confidence >= 50) break;
          }

          // Contrast-stretched grayscale on upscaled cheque
          const { canvas: strChq, ctx: strChqCtx } = await loadImageToCanvas(upChqPath);
          stretchContrastGray(strChq, strChqCtx);
          const strChqPath = writeTempImage(canvasToBuffer(strChq), imagePath, "_cheque_stretch");
          tempFiles.push(strChqPath);
          for (const psm of [6, 3]) {
            const r = await runOcrPass(strChqPath, docType, psm, false);
            combinedText += "\n" + (r.text || "");
            if (r.score > bestResult.score) { bestResult = r; }
            if (!hasMissing(bestResult.parsed, docType) && bestResult.confidence >= 50) break;
          }
        }

        // Sauvola binarization for faint printed text
        const sauvolaChqPath = await preprocessImageSauvola(imagePath);
        if (sauvolaChqPath) {
          tempFiles.push(sauvolaChqPath);
          for (const psm of [6, 3]) {
            const r = await runOcrPass(sauvolaChqPath, docType, psm, false);
            combinedText += "\n" + (r.text || "");
            if (r.score > bestResult.score) { bestResult = r; }
            if (!hasMissing(bestResult.parsed, docType) && bestResult.confidence >= 50) break;
          }
        }
      } catch (_) {}
    }

    // PAN images: crop to card region + Sauvola binarization. PAN cards have
    // faint teal/blue embossed text that Otsu and contrast-stretch miss. Sauvola
    // adaptive thresholding recovers these. Also crop+upscale the card first so
    // the tiny card text is large enough for OCR (same as scanPanPdf does).
    if (type === "PAN") {
      try {
        const { canvas: panImg } = await loadImageToCanvas(imagePath);
        const panCard = cropAndUpscaleCanvas(panImg, 1800);
        const panCardPath = writeTempImage(canvasToBuffer(panCard), imagePath, "_pancard");
        tempFiles.push(panCardPath);

        // Sauvola on cropped card
        const sauvolaPath = await preprocessImageSauvola(panCardPath);
        if (sauvolaPath) {
          tempFiles.push(sauvolaPath);
          for (const psm of [6, 4, 3]) {
            const r = await runOcrPass(sauvolaPath, docType, psm, false);
            combinedText += "\n" + (r.text || "");
            if (r.score > bestResult.score) { bestResult = r; }
            if (!hasMissing(bestResult.parsed, docType) && bestResult.confidence >= 50) break;
          }
        }

        // Mild contrast on cropped card (matches PAN PDF Variant 0)
        const { canvas: mildCard, ctx: mildCtx } = await loadImageToCanvas(panCardPath);
        mildContrastGray(mildCard, mildCtx, 2);
        const mildPath = writeTempImage(canvasToBuffer(mildCard), imagePath, "_pancard_mild");
        tempFiles.push(mildPath);
        for (const psm of [6, 4, 3]) {
          const r = await runOcrPass(mildPath, docType, psm, false);
          combinedText += "\n" + (r.text || "");
          if (r.score > bestResult.score) { bestResult = r; }
          if (!hasMissing(bestResult.parsed, docType) && bestResult.confidence >= 50) break;
        }

        // Contrast-stretched grayscale on cropped card
        const { canvas: stretchCard, ctx: stretchCtx } = await loadImageToCanvas(panCardPath);
        stretchContrastGray(stretchCard, stretchCtx);
        const stretchPath = writeTempImage(canvasToBuffer(stretchCard), imagePath, "_pancard_stretch");
        tempFiles.push(stretchPath);
        for (const psm of [6, 4]) {
          const r = await runOcrPass(stretchPath, docType, psm, false);
          combinedText += "\n" + (r.text || "");
          if (r.score > bestResult.score) { bestResult = r; }
          if (!hasMissing(bestResult.parsed, docType) && bestResult.confidence >= 50) break;
        }
      } catch (_) {}
    }

    // For text-dense docs (GST/PAN/MSME): if primary fields are still missing,
    // the source image is usually a small / heavily-compressed scan where tiny
    // lines like the GSTIN OCR as garbage at native size. Upscale ~3x so the
    // glyphs are large enough to resolve. Use only soft preprocessing here
    // (plain upscale, then contrast-stretched grayscale) â hard binarization
    // (Otsu/Sauvola) shreds faint thin strokes on this kind of scan and turns
    // noise into long character runs that the GSTIN fixer can coerce into a
    // checksum-valid but wrong number.
    if (type !== "CANCELLED_CHEQUE" && hasMissing(bestResult.parsed, docType)) {
      try {
        const { canvas: pageCanvas, width: srcW } = await loadImageToCanvas(imagePath);
        // Plain full-page upscale (no crop). Cropping to the content bbox here
        // can latch onto a narrow column and over-scale into artifacts; a clean
        // ~3x of the whole page brings tiny text (e.g. the GSTIN) to a readable
        // size while preserving stroke shape. Cap the factor so we never enlarge
        // an already-large scan.
        const factor = Math.min(3, Math.max(1, 1700 / srcW));
        const upCanvas = scaleCanvas(pageCanvas, factor);
        const upPath = writeTempImage(canvasToBuffer(upCanvas), imagePath, "_upscaled");
        tempFiles.push(upPath);

        // Variant A â plain upscale (no thresholding).
        for (const psm of [6, 4, 3, 11]) {
          const r = await runOcrPass(upPath, docType, psm, useHindi);
          combinedText += "\n" + (r.text || "");
          if (r.score > bestResult.score) { bestResult = r; }
          if (!hasMissing(bestResult.parsed, docType) && bestResult.confidence >= 50) break;
        }

        // Variant B â contrast-stretched grayscale of the upscaled page.
        if (hasMissing(bestResult.parsed, docType)) {
          const { canvas: grayCanvas, ctx: grayCtx } = await loadImageToCanvas(upPath);
          stretchContrastGray(grayCanvas, grayCtx);
          const grayPath = writeTempImage(canvasToBuffer(grayCanvas), imagePath, "_upscaledgray");
          tempFiles.push(grayPath);
          for (const psm of [6, 4, 3, 11]) {
            const r = await runOcrPass(grayPath, docType, psm, useHindi);
            combinedText += "\n" + (r.text || "");
            if (r.score > bestResult.score) { bestResult = r; }
            if (!hasMissing(bestResult.parsed, docType) && bestResult.confidence >= 50) break;
          }
        }
      } catch (_) {}
    }

    // For cheques: also try resized version
    if (type === "CANCELLED_CHEQUE") {
      try {
        const { canvas, width, height } = await loadImageToCanvas(imagePath);
        const targetWidth = 2000;
        if (Math.abs(width - targetWidth) > 500) {
          const scale = targetWidth / width;
          const { canvas: resized, ctx: rCtx } = makeCanvas(targetWidth, Math.round(height * scale));
          rCtx.drawImage(canvas, 0, 0, resized.width, resized.height);

          // Sharpen
          const imageData = rCtx.getImageData(0, 0, resized.width, resized.height);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            gray = ((gray - 128) * 1.5) + 128;
            gray = Math.max(0, Math.min(255, gray));
            data[i] = data[i + 1] = data[i + 2] = Math.round(gray);
          }
          rCtx.putImageData(imageData, 0, 0);

          const resizedPath = writeTempImage(canvasToBuffer(resized), imagePath, "_resized");
          tempFiles.push(resizedPath);
          const resizedResult = await runOcrPass(resizedPath, docType, 6, useHindi);
          combinedText += "\n" + (resizedResult.text || "");
          if (resizedResult.score > bestResult.score) {
            bestResult = resizedResult;
          }
        }
      } catch (_) {}
    }

    // Finalize with combined text merge
    const result = finalize(bestResult, combinedText, docType);

    // PAN cards: read the number from the strip beneath the "ACCOUNT NUMBER"
    // label. Isolating and magnifying just the value reads the faint/embossed
    // digits far more reliably than whole-card OCR, which otherwise returns a
    // confident wrong PAN. A hit is structurally validated, so trust it.
    if (type === "PAN") {
      try {
        const { canvas: imgCanvas } = await loadImageToCanvas(imagePath);
        const panVotes = {};

        // Multi-scale voting (mirrors the PAN PDF pipeline). Scale the image
        // to several widths so faint/embossed digits get enough pixels at at
        // least one scale. Each scale votes; the true PAN recurs while
        // per-scale misreads scatter.
        for (const tw of [1200, 1700, 2400]) {
          const scaled = cropAndUpscaleCanvas(imgCanvas, tw);
          await extractPanByLabel(scaled, imagePath, tempFiles, panVotes, tw / 1000);
        }
        // Also try original size
        await extractPanByLabel(imgCanvas, imagePath, tempFiles, panVotes);

        // Sauvola-preprocessed card (handles faint teal text that fails with
        // Otsu/contrast). This is the same preprocessing PAN PDFs get but was
        // missing from the image path.
        try {
          const cardCanvas = cropAndUpscaleCanvas(imgCanvas, 1800);
          const sauvolaCardPath = writeTempImage(canvasToBuffer(cardCanvas), imagePath, "_pancard_sauvola");
          tempFiles.push(sauvolaCardPath);
          const sauvolaPath = await preprocessImageSauvola(sauvolaCardPath);
          if (sauvolaPath) {
            tempFiles.push(sauvolaPath);
            const sauvolaResult = await runOcrPass(sauvolaPath, docType, 6, false);
            combinedText += "\n" + (sauvolaResult.text || "");
            if (sauvolaResult.score > bestResult.score) { bestResult = sauvolaResult; }
            // Also run label-anchored extraction on Sauvola version
            const { canvas: sc } = await loadImageToCanvas(sauvolaPath);
            await extractPanByLabel(sc, imagePath, tempFiles, panVotes, 2);
          }
        } catch (_) {}

        let bestVotes = 0, stripPan = null;
        for (const p of Object.keys(panVotes)) { if (panVotes[p] > bestVotes) { stripPan = p; bestVotes = panVotes[p]; } }
        if (stripPan) {
          result.panNumber = stripPan;
          ocrLog("panByLabel", { docType, source: "label-strip-vote", variant: `votes=${bestVotes}`, text: stripPan });
        }
      } catch (_) {}
    }

    // Cheque crop pass â run when account number is short OR IFSC is missing.
    // The crop focuses on the A/c + IFSC region (x:7-55%, y:30-60%) for
    // cleaner OCR on the key fields.
    if (type === "CANCELLED_CHEQUE" && (
      (result.accountNumber && result.accountNumber.length < 14) ||
      !result.ifscCode ||
      !result.accountNumber
    )) {
      const cropResult = await chequeCropPass(imagePath, result.accountNumber || "", result.ifscCode, docType, useHindi);
      if (cropResult) {
        if (cropResult.extendedAcct) {
          result.accountNumber = cropResult.extendedAcct;
        }
        if (!result.ifscCode && cropResult.cropIfsc) {
          result.ifscCode = cropResult.cropIfsc;
          // Derive bank name from newly found IFSC
          if (!result.bankName) {
            result.bankName = require("./parsers.js").bankNameFromIfsc(cropResult.cropIfsc);
          }
        }
        // If account was missing entirely, try from crop parse
        if (!result.accountNumber && cropResult.cropText) {
          const cropParsed = parseByType(cropResult.cropText, docType);
          if (cropParsed.accountNumber) {
            result.accountNumber = cropParsed.accountNumber;
          }
        }
        // Include cheque crop OCR text in rawText
        if (cropResult.cropText) {
          result.rawText = deduplicateLines((result.rawText || "") + "\n" + cropResult.cropText);
        }
      }
    }

    return result;
  } finally {
    for (const f of tempFiles) { cleanupTemp(f); }
  }
}

// âââ Text deduplication âââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function deduplicateLines(text) {
  if (!text) return "";
  const seen = new Set();
  return text.split("\n").filter(line => {
    const t = line.trim();
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return true;
  }).join("\n");
}

// âââ Finalize: merge combined text results into best ââââââââââââââââââââââââ

function finalize(best, allText, docType) {
  let result = { ...best.parsed };

  // Re-parse combined text and merge missing fields
  if (allText && allText.trim()) {
    const combinedParsed = parseByType(allText, docType);
    result = mergeCombinedResult(result, combinedParsed, docType);
  }

  // rawText = deduplicated union of ALL text sources, not just best pass
  result.rawText = allText && allText.trim()
    ? deduplicateLines(allText + "\n" + (best.text || ""))
    : (best.text || "");

  // Final safety net: the deduplicated rawText is often cleaner than the raw
  // allText (duplicate lines removed, less noise). Re-parse it and fill any
  // fields that are still missing so that data visible in rawText is never
  // lost in the structured result.
  if (result.rawText) {
    const rawParsed = parseByType(result.rawText, docType);
    const fields = expectedFields(docType);
    for (const f of fields) {
      if (f === "rawText") continue;
      if (!result[f] && rawParsed[f]) {
        result[f] = rawParsed[f];
      }
    }
  }

  ocrLog("finalize", { docType, source: "finalize", text: result.rawText, confidence: best.confidence });
  return result;
}

// Invoice parser extracted to invoice-parser.js for maintainability
const { parseInvoiceData, parseCreditNoteData } = require("./invoice-parser.js");

// âââ Invoice/Credit Note PDF extraction (multi-page) ââââââââââââââââââââââââ

async function extractTextFromPDFAllPages(pdfPath) {
  const buffer = await fsp.readFile(pdfPath);
  const sources = [];

  // Collect text from pdf-parse
  let pdfParseText = "";
  try {
    const data = await pdfParse(buffer);
    if (data.text && data.text.trim().length > 10) {
      pdfParseText = data.text;
      ocrLog("extractTextFromPDFAllPages", { source: "pdf-parse", text: pdfParseText });
    }
  } catch (_) {}
  if (pdfParseText) sources.push(pdfParseText);

  // Collect text from Y-coordinate grouped extraction
  try {
    const pdfText = await extractPdfTextWithLineBreaks(buffer);
    if (pdfText && pdfText.trim().length > 10) {
      sources.push(pdfText);
      ocrLog("extractTextFromPDFAllPages", { source: "pdfjs-linebreaks", text: pdfText });
    }
  } catch (_) {}

  // Digital PDFs (e.g. BookMyShow invoices) carry a clean embedded text layer.
  // Rendering each page and running Tesseract on top of that adds OCR noise that
  // survives dedup and spawns phantom/duplicate line items â most notably the
  // Net/Tax/Grand-Total footer mis-read as an extra line item. When the text
  // layer is already substantial, trust it and skip image OCR; fall back to OCR
  // only for scanned PDFs whose text layer is empty or sparse.
  const digitalText = sources.join("\n");
  const digitalAlphaLines = digitalText
    .split("\n")
    .filter((l) => /[A-Za-z]{3,}/.test(l)).length;
  if (digitalText.trim().length >= 200 && digitalAlphaLines >= 10) {
    ocrLog("extractTextFromPDFAllPages", { source: "text-layer-only", text: digitalText });
    return deduplicateLines(digitalText);
  }

  // Render + multi-PSM OCR each page. Scanned (non-digital) PDFs get the same
  // treatment image invoices get: a higher render scale plus an Otsu-binarized
  // pass, which lifts faint/low-contrast printed text (e.g. dot-matrix fuel and
  // transport bills) that the raw render alone reads as noise. PSM 4 (assume a
  // single column of variable-size text) is added on the binarized image because
  // it reconstructs tabular item rows better than PSM 6/3 on such layouts.
  const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const numPages = doc.numPages;
  let ocrText = "";

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const { tempPath } = await renderPdfPageToImage(buffer, pdfPath, pageNum, 3.5);
    const otsuPath = await preprocessImageOtsu(tempPath);
    try {
      // Union every pass so no word is lost; downstream deduplicateLines() drops
      // repeats. PSM 6 + PSM 3 on the raw render, PSM 6 + PSM 4 on the binarized.
      const passes = [
        ocrImage(tempPath, 6, false),
        ocrImage(tempPath, 3, false),
      ];
      if (otsuPath) {
        passes.push(ocrImage(otsuPath, 6, false), ocrImage(otsuPath, 4, false));
      }
      const results = await Promise.all(passes);
      ocrText += results.map((r) => r.text || "").join("\n") + "\n";
    } finally {
      cleanupTemp(tempPath);
      if (otsuPath) cleanupTemp(otsuPath);
    }
  }

  if (ocrText.trim()) sources.push(ocrText);

  // Merge all sources, deduplicate
  return deduplicateLines(sources.join("\n"));
}

// Petrol-bunk "Credit Bill" tables (Particulars/Rate/Lts./Amount columns with
// DIESEL/PETROL/OIL rows) are hand-filled â the Rate/Lts/Amount cells are
// handwritten and unreadable by Tesseract at any resolution or binarization, so
// generic line-item extraction only finds noise. The printed Particulars-column
// labels are legible once isolated, but at whole-page scale "DIESEL"/"OIL" get
// fused with the handwriting beside them into garbage tokens. "PETROL" alone
// consistently survives whole-page OCR, so anchor on it: its bounding box gives
// the row height and column position, and the row directly above it is the
// filled-in fuel row. Crop and re-OCR just that cell to read which fuel it is.
async function extractFuelBillItem(buffer, pdfPath) {
  let tempPath, cropPath;
  try {
    ({ tempPath } = await renderPdfPageToImage(buffer, pdfPath, 1, 5));
    const { words } = await ocrWords(tempPath, 6);
    const petrol = words.find((w) => /PE[TR]{1,3}[O0o]L/i.test(w.text));
    if (!petrol) return null;

    const { canvas } = await loadImageToCanvas(tempPath);
    const rowH = petrol.bbox.y1 - petrol.bbox.y0;
    const x0 = Math.max(0, petrol.bbox.x0 - 10);
    const x1 = Math.min(canvas.width, petrol.bbox.x1 + 400);
    const y1 = petrol.bbox.y0;
    const y0 = Math.max(0, y1 - Math.round(rowH * 2.2));
    const w = x1 - x0, h = y1 - y0;
    if (w < 10 || h < 10) return null;

    const { canvas: crop, ctx } = makeCanvas(w, h);
    ctx.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
    const big = scaleCanvas(crop, 3);
    cropPath = writeTempImage(canvasToBuffer(big), tempPath, "_fuelitem");

    const { text } = await ocrImage(cropPath, 7, false);
    const m = text.match(/[A-Za-z]{3,}/);
    if (!m) return null;
    const token = m[0].toUpperCase();

    // The "L" in "DIESEL" often fuses with the adjacent handwritten checkmark
    // into a non-letter glyph, so the crop reads "DIESE". Snap such truncated
    // reads back to the standard IOC Credit Bill row labels.
    const KNOWN_FUEL_ROWS = ["DIESEL", "PETROL", "POWER", "PREMIUM", "SPEED", "XTRAPREMIUM"];
    const known = KNOWN_FUEL_ROWS.find((f) => token.length >= 4 && f.startsWith(token));
    return known || (token.length >= 4 ? token : null);
  } catch (_) {
    return null;
  } finally {
    if (tempPath) cleanupTemp(tempPath);
    if (cropPath) cleanupTemp(cropPath);
  }
}

// âââ Document type normalization ââââââââââââââââââââââââââââââââââââââââââââ
const DOC_TYPES = ["GST", "PAN", "MSME", "CANCELLED_CHEQUE", "INVOICE", "CREDIT_NOTE"];

/**
 * Run OCR + parse for a file on disk, given a normalized docType (uppercase enum).
 */
async function scanDocument(filePath, docType) {
  const type = String(docType || "").toUpperCase();
  const isPdf = path.extname(filePath).toLowerCase() === ".pdf";

  // Invoice and Credit Note use the dedicated invoice parser
  if (type === "INVOICE" || type === "CREDIT_NOTE") {
    let rawText;
    if (isPdf) {
      rawText = await extractTextFromPDFAllPages(filePath);
    } else {
      // For image invoices, use full preprocessing pipeline (upscaling, binarization, multi-PSM)
      // same as GST/PAN/MSME/Cheque images â not just raw multiPsmOcr
      const tempFiles = [];
      try {
        const { best, allText } = await multiPsmOcr(filePath, type, false);
        let bestResult = best;
        let combinedText = allText;

        // Otsu binarized pass
        const otsuPath = await preprocessImageOtsu(filePath);
        if (otsuPath) {
          tempFiles.push(otsuPath);
          const otsuResult = await runOcrPass(otsuPath, type, 6, false);
          combinedText += "\n" + (otsuResult.text || "");
          if (otsuResult.score > bestResult.score) { bestResult = otsuResult; }
        }

        // Resized pass for small images
        try {
          const { width, height } = await loadImageToCanvas(filePath);
          const targetWidth = 2000;
          if (Math.abs(width - targetWidth) > 500) {
            const scale = targetWidth / width;
            const { canvas: resized, ctx: rCtx } = makeCanvas(targetWidth, Math.round(height * scale));
            const { loadImage } = getCanvas();
            const img = await loadImage(filePath);
            rCtx.drawImage(img, 0, 0, resized.width, resized.height);
            const imageData = rCtx.getImageData(0, 0, resized.width, resized.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
              let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              gray = ((gray - 128) * 1.5) + 128;
              gray = Math.max(0, Math.min(255, gray));
              data[i] = data[i + 1] = data[i + 2] = Math.round(gray);
            }
            rCtx.putImageData(imageData, 0, 0);
            const resizedPath = writeTempImage(canvasToBuffer(resized), filePath, "_resized");
            tempFiles.push(resizedPath);
            const resizedResult = await runOcrPass(resizedPath, type, 6, false);
            combinedText += "\n" + (resizedResult.text || "");
            if (resizedResult.score > bestResult.score) { bestResult = resizedResult; }
          }
        } catch (_) {}

        rawText = deduplicateLines((combinedText || "") + "\n" + (bestResult.text || ""));
      } finally {
        for (const f of tempFiles) { cleanupTemp(f); }
      }
    }
    const typeName = type === "INVOICE" ? "invoice" : "credit_note";
    const parser = type === "CREDIT_NOTE" ? parseCreditNoteData : parseInvoiceData;
    const parsed = parser(rawText);

    // Petrol-bunk "Credit Bill" tables: Particulars/Rate/Lts./Amount columns
    // with a "Rs. | Ps." amount split and DIESEL/PETROL/OIL rows. Detect via the
    // "PETROL" row label plus the "Ps." paise column header, then replace the
    // generic (garbage) item list with the actual filled-in fuel type; the
    // handwritten Rate/Lts/Amount are genuinely unreadable, so leave them null.
    if (isPdf && /PE[TR]{1,3}[O0o]L/i.test(rawText) && /\bPs\b/i.test(rawText)) {
      const buffer = await fsp.readFile(filePath);
      const fuelItem = await extractFuelBillItem(buffer, filePath);
      if (fuelItem) {
        parsed.items = [{
          item_no: 1,
          description: fuelItem,
          hsn_code: null,
          quantity: null,
          unit: "ltr",
          unit_price: null,
          net_value: null,
          tax_amount: null,
          currency: (parsed.totals && parsed.totals.currency) || "INR",
        }];
        if (parsed.totals) {
          parsed.totals.total_value = null;
          parsed.totals.grand_total = null;
        }
      }
    }

    return { type: typeName, ...parsed };
  }

  // GST, PAN, MSME, CANCELLED_CHEQUE use the multi-pass pipeline
  const result = await scanDocumentWithMultiPass(filePath, type);
  const typeMap = { GST: "gst", PAN: "pan", MSME: "msme", CANCELLED_CHEQUE: "cancelled_cheque" };
  return { type: typeMap[type] || "unknown", ...result };
}

/**
 * Sniff file extension from magic bytes (PDF / JPEG / PNG / WEBP).
 */
function sniffExtension(buffer) {
  if (buffer.length >= 5 && buffer.toString("latin1", 0, 5) === "%PDF-") return ".pdf";
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return ".jpg";
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return ".png";
  if (buffer.length >= 12 && buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return ".webp";
  return ".png";
}

/**
 * Coerce a CAP LargeBinary action parameter into a Buffer.
 */
async function toBuffer(fileContent) {
  if (!fileContent) throw new Error("fileContent is required");
  if (Buffer.isBuffer(fileContent)) return fileContent;
  if (typeof fileContent === "string") {
    const base64 = fileContent.includes(",") ? fileContent.split(",").pop() : fileContent;
    return Buffer.from(base64, "base64");
  }
  if (typeof fileContent.pipe === "function" || typeof fileContent.on === "function") {
    const chunks = [];
    for await (const chunk of fileContent) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (fileContent.value) return toBuffer(fileContent.value);
  throw new Error("Unsupported fileContent type");
}

/**
 * Public entry point: process raw file content for a given docType.
 */
async function processFileContent(fileContent, docType) {
  const type = String(docType || "").toUpperCase();
  if (!DOC_TYPES.includes(type)) {
    throw new Error(`docType must be one of: ${DOC_TYPES.join(", ")}`);
  }

  const buffer = await toBuffer(fileContent);
  if (!buffer || buffer.length === 0) {
    throw new Error("Uploaded file is empty");
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds maximum of 10MB`);
  }

  const ext = sniffExtension(buffer);
  const tempPath = path.join(
    os.tmpdir(),
    `ocr-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`,
  );
  await fsp.writeFile(tempPath, buffer);

  try {
    return await scanDocument(tempPath, type);
  } finally {
    cleanupTemp(tempPath);
  }
}

module.exports = {
  DOC_TYPES,
  scanDocument,
  processFileContent,
  // parsers exported for testing
  parseGSTData,
  parsePANData,
  parseMSMEData,
  parseChequeData,
  parseInvoiceData,
  parseCreditNoteData,
  // helpers exported for testing
  deduplicateLines,
};
