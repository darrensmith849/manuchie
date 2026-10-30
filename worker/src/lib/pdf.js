/* A small PDF writer (PDF 1.4) with no dependencies: the standard Helvetica and Times fonts
   (WinAnsi encoding, real character widths for alignment and wrapping), filled and stroked
   shapes, and JPEG images (optionally clipped to a circle). Layout uses top-left coordinates
   in points (A4 = 595.28 × 841.89). */

// Character widths (1/1000 em) for codes 32–126, from the standard AFM metrics.
const W = {
  F1: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584],
  F2: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584],
  F3: [250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541],
  F4: [250,333,420,500,500,833,778,214,333,333,500,675,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,675,675,675,500,920,611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,611,722,611,500,556,722,611,833,611,556,556,389,278,389,422,500,333,500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,500,500,389,389,278,500,444,667,444,444,389,400,275,400,541],
};
const FONTS = { F1: "Helvetica", F2: "Helvetica-Bold", F3: "Times-Roman", F4: "Times-Italic" };

// Unicode → WinAnsi for the characters outside Latin-1 that invoices actually use.
const WINANSI = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };
const WIDE = { 0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000 };

/* Text → WinAnsi byte codes (anything unknown becomes "?"). */
export function encodeWinAnsi(str) {
  const out = [];
  for (const ch of String(str).normalize("NFC")) {
    const c = ch.codePointAt(0);
    if (c === 0x09) out.push(32);
    else if (c >= 32 && c <= 126) out.push(c);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else if (WINANSI[ch]) out.push(WINANSI[ch]);
    else if (c === 0x2009 || c === 0x202f || c === 0x00a0) out.push(32);
    else out.push(63);
  }
  return out;
}

export function textWidth(str, font, size) {
  let w = 0;
  for (const b of encodeWinAnsi(str)) w += b >= 32 && b <= 126 ? W[font][b - 32] : WIDE[b] || 556;
  return (w * size) / 1000;
}

/* Word-wraps text (honouring newlines) to a width. */
export function wrapText(str, font, size, maxWidth) {
  const lines = [];
  for (const para of String(str || "").split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let line = "";
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (textWidth(test, font, size) <= maxWidth || !line) {
        // a single word longer than the line is broken by characters
        if (!line && textWidth(word, font, size) > maxWidth) {
          let part = "";
          for (const ch of word) { if (textWidth(part + ch, font, size) > maxWidth) { lines.push(part); part = ch; } else part += ch; }
          line = part;
        } else line = test;
      } else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

const esc = (bytes) => bytes.map((b) => (b === 40 || b === 41 || b === 92 ? "\\" + String.fromCharCode(b) : b > 126 ? "\\" + b.toString(8).padStart(3, "0") : String.fromCharCode(b))).join("");
const num = (n) => (Math.round(n * 100) / 100).toString();
function rgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(" ");
}

/* JPEG size and colour components, from the SOF marker. */
export function jpegInfo(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("not a JPEG");
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const m = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] };
    }
    i += 2 + len;
  }
  throw new Error("JPEG size not found");
}

class Page {
  constructor(doc, w, h) { this.doc = doc; this.w = w; this.h = h; this.ops = []; this.xobjects = new Set(); }
  Y(y) { return this.h - y; }
  rect(x, y, w, h, { fill, stroke, lineWidth = 1, radius = 0 } = {}) {
    const o = this.ops;
    o.push("q");
    if (fill) o.push(rgb(fill) + " rg");
    if (stroke) o.push(rgb(stroke) + " RG", num(lineWidth) + " w");
    if (radius > 0) this.roundPath(x, y, w, h, Math.min(radius, w / 2, h / 2));
    else o.push(`${num(x)} ${num(this.Y(y + h))} ${num(w)} ${num(h)} re`);
    o.push(fill && stroke ? "B" : fill ? "f" : "S", "Q");
    return this;
  }
  roundPath(x, y, w, h, r) {
    const k = 0.5523 * r, X = x, T = this.Y(y), B = this.Y(y + h), R = x + w;
    this.ops.push(`${num(X + r)} ${num(T)} m`, `${num(R - r)} ${num(T)} l`, `${num(R - r + k)} ${num(T)} ${num(R)} ${num(T - r + k)} ${num(R)} ${num(T - r)} c`,
      `${num(R)} ${num(B + r)} l`, `${num(R)} ${num(B + r - k)} ${num(R - r + k)} ${num(B)} ${num(R - r)} ${num(B)} c`,
      `${num(X + r)} ${num(B)} l`, `${num(X + r - k)} ${num(B)} ${num(X)} ${num(B + r - k)} ${num(X)} ${num(B + r)} c`,
      `${num(X)} ${num(T - r)} l`, `${num(X)} ${num(T - r + k)} ${num(X + r - k)} ${num(T)} ${num(X + r)} ${num(T)} c`, "h");
  }
  line(x1, y1, x2, y2, { color = "#000000", width = 1 } = {}) {
    this.ops.push("q", rgb(color) + " RG", num(width) + " w", `${num(x1)} ${num(this.Y(y1))} m ${num(x2)} ${num(this.Y(y2))} l S`, "Q");
    return this;
  }
  /* y is the text baseline, measured from the top. */
  text(str, x, y, { font = "F1", size = 10, color = "#000000", spacing = 0, align = "left" } = {}) {
    const s = String(str ?? "");
    if (!s) return 0;
    const w = textWidth(s, font, size) + spacing * Math.max(0, [...s].length - 1);
    const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    this.ops.push("BT", `/${font} ${num(size)} Tf`, rgb(color) + " rg", spacing ? num(spacing) + " Tc" : "0 Tc",
      `${num(left)} ${num(this.Y(y))} Td`, `(${esc(encodeWinAnsi(s))}) Tj`, "ET");
    return w;
  }
  /* Draws wrapped text; returns the y of the line after the last one. */
  paragraph(str, x, y, maxWidth, { font = "F1", size = 10, color = "#000000", leading = 1.45 } = {}) {
    let yy = y;
    for (const line of wrapText(str, font, size, maxWidth)) { if (line) this.text(line, x, yy, { font, size, color }); yy += size * leading; }
    return yy;
  }
  image(img, x, y, w, h, { circle = false, radius = 0 } = {}) {
    this.xobjects.add(img.name);
    this.ops.push("q");
    if (radius > 0 && !circle) { this.roundPath(x, y, w, h, Math.min(radius, w / 2, h / 2)); this.ops.push("W n"); }
    if (circle) {
      const r = Math.min(w, h) / 2, cx = x + w / 2, cy = this.Y(y + h / 2), k = 0.5523 * r;
      this.ops.push(`${num(cx + r)} ${num(cy)} m`, `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c`,
        `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c`,
        `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c`,
        `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c`, "W n");
    }
    this.ops.push(`${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.Y(y + h))} cm`, `/${img.name} Do`, "Q");
    return this;
  }
}

export class Pdf {
  constructor({ title = "", author = "", subject = "" } = {}) { this.pages = []; this.images = []; this.info = { title, author, subject }; }
  page(w = 595.28, h = 841.89) { const p = new Page(this, w, h); this.pages.push(p); return p; }
  jpeg(bytes) {
    const info = jpegInfo(bytes);
    const img = { name: "Im" + (this.images.length + 1), bytes, ...info };
    this.images.push(img);
    return img;
  }
  bytes() {
    const chunks = [];
    let length = 0;
    const offsets = [];
    const push = (part) => { const b = typeof part === "string" ? latin1(part) : part; chunks.push(b); length += b.length; };
    const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
    const obj = (n, body, stream) => {
      offsets[n] = length;
      push(`${n} 0 obj\n${body}\n`);
      if (stream) { push("stream\n"); push(stream); push("\nendstream\n"); }
      push("endobj\n");
    };
    const fontIds = {}, imageIds = {};
    let n = 3;
    for (const f of Object.keys(FONTS)) fontIds[f] = n++;
    for (const img of this.images) imageIds[img.name] = n++;
    const pageIds = this.pages.map(() => { const p = n; n += 2; return p; });
    const infoId = n++;

    push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => id + " 0 R").join(" ")}] /Count ${pageIds.length} >>`);
    for (const [f, base] of Object.entries(FONTS)) obj(fontIds[f], `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
    for (const img of this.images) {
      obj(imageIds[img.name], `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.components === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`, img.bytes);
    }
    this.pages.forEach((p, i) => {
      const id = pageIds[i];
      const content = latin1(p.ops.join("\n"));
      const fonts = Object.entries(fontIds).map(([f, fid]) => `/${f} ${fid} 0 R`).join(" ");
      const xo = [...p.xobjects].map((name) => `/${name} ${imageIds[name]} 0 R`).join(" ");
      obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.w)} ${num(p.h)}] /Resources << /Font << ${fonts} >>${xo ? ` /XObject << ${xo} >>` : ""} >> /Contents ${id + 1} 0 R >>`);
      obj(id + 1, `<< /Length ${content.length} >>`, content);
    });
    const pdfString = (s) => `(${esc(encodeWinAnsi(s))})`;
    obj(infoId, `<< /Title ${pdfString(this.info.title)} /Author ${pdfString(this.info.author)} /Subject ${pdfString(this.info.subject)} /Producer (manuchie.org) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`);
    const xref = length;
    let table = `xref\n0 ${n}\n0000000000 65535 f \n`;
    for (let i = 1; i < n; i++) table += String(offsets[i] || 0).padStart(10, "0") + " 00000 n \n";
    push(table);
    push(`trailer\n<< /Size ${n} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}
