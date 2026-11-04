// Fills HomePro's own Agreement and Package Worksheet PDFs, draws the stair diagram,
// and merges everything (plus staircase / ID photos) into one job packet.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { AGREEMENT_PDF, ORDER_PDF } from "./templates.mjs";

const INK = rgb(0.05, 0.16, 0.45); // pen-blue so filled-in values stand out like handwriting
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.45, 0.45, 0.5);
const H = 792; // both templates are US Letter

// ---------------- catalog ----------------
// agrRow: line on the Agreement (0 = first "We are installing" line)
// order: { col: "L"|"M", top } = row on the Package Worksheet (top = PDF text yMin, top-origin)
export const PRODUCTS = {
  is350: { label: "Harmar Indigo IS350 straight", kind: "straight", agrRow: 0, order: { col: "M", top: 558.7 } },
  sl600hd: { label: "Harmar SL600HD straight", kind: "straight", agrRow: 2, order: { col: "M", top: 545.6 } },
  hc1000out: { label: "Handicare 1000 Outdoor straight", kind: "straight", agrRow: 6, order: { col: "M", top: 416.1 } },
  helix: { label: "Harmar Helix custom curved", kind: "curved", agrRow: 3, order: null },
  upmodular: { label: "Harmar UP modular curved", kind: "curved", agrRow: 4, order: "upmodular" },
  freecurve: { label: "Handicare Freecurve curved", kind: "curved", agrRow: 7, order: "freecurve" },
  hc4000: { label: "Handicare 4000 curved", kind: "curved", agrRow: 8, order: null },
};
export const VPLS = {
  VPL400: { max: 53, top: 559.9 }, VPL600: { max: 77, top: 572.9 }, VPL800: { max: 101, top: 585.9 },
  VPL1000: { max: 125, top: 598.9 }, VPL1200: { max: 149, top: 611.9 },
};
export const VPL_FEATURES = {
  topGate: { label: "VPL top landing gate", top: 637.1 },
  bottomGate: { label: "VPL bottom landing gate", top: 650.1 },
  outdoor: { label: "VPL outdoor upgrade", top: 663.1 },
  battery: { label: "VPL battery backup", top: 676.1 },
  callSends: { label: "VPL call sends (2 required)", top: 689.1, qty: true },
};
export const EXTRAS = {
  foldingRail: { label: "Folding rail upgrade", col: "M", top: 571.7, agrRow: 10 },
  extraRail: { label: "Additional straight rail 6FT", col: "M", top: 584.8, qty: true },
  outlet: { label: "Add-on electrical outlet", col: "M", top: 597.9 },
  tallBrackets: { label: "Tall brackets", line: 704 },
  ext10: { label: "Factory 10FT extension", line: 726 },
  scooter: { label: "Pride 3-wheel scooter", col: "L", top: 713.9, agrRow: 5 },
  liftChair: { label: "Pride lift chair", col: "L", top: 726.9, agrRow: 5 },
  pollock: { label: "Pollock residential elevator", col: "L", top: 741.0, agrRow: 9 },
};
export const GRAB_BARS = { 12: 455.0, 16: 468.0, 18: 481.0, 24: 494.0, 36: 507.0, 42: 520.0, 48: 533.0 };
const UP_ROWS = { 1: 363.0, 2: 350.0, 3: 337.0 }; // UP-S1000-52/64/66 by number of 90° turns
const FREECURVE_ROWS = { 1: 455.0, 2: 468.0 }; // FreeCurve 90 / 180 degree
const COLS = { L: [157.7, 201.6], M: [345.6, 389.4] };

// ---------------- helpers ----------------
const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clean = (s) => String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
function fit(font, text, size, maxW) {
  let t = clean(text), s = size;
  while (s > 5.5 && font.widthOfTextAtSize(t, s) > maxW) s -= 0.25;
  while (t && font.widthOfTextAtSize(t, s) > maxW) t = t.slice(0, -1);
  return { t, s };
}
function wrap(font, size, text, maxW) {
  const out = [];
  for (const para of clean(text).split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(test, size) <= maxW) line = test;
      else { if (line) out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}
/** Text on a blank: x0..x1, baseline given in top-origin coords. */
function put(page, font, text, x0, x1, baseTop, size = 9.5, color = INK) {
  if (text === undefined || text === null || text === "") return;
  const { t, s } = fit(font, text, size, x1 - x0);
  page.drawText(t, { x: x0, y: H - baseTop, size: s, font, color });
}
function check(page, cx, cyTop, s = 7, color = INK) {
  const x = cx - s / 2, y = H - cyTop - s / 2;
  page.drawLine({ start: { x, y: y + s * 0.5 }, end: { x: x + s * 0.38, y }, thickness: 1.4, color });
  page.drawLine({ start: { x: x + s * 0.38, y }, end: { x: x + s, y: y + s }, thickness: 1.4, color });
}
function circle(page, x0, x1, top, bottom) {
  page.drawEllipse({ x: (x0 + x1) / 2, y: H - (top + bottom) / 2, xScale: (x1 - x0) / 2, yScale: (bottom - top) / 2, borderColor: INK, borderWidth: 1 });
}
function rowMark(page, font, col, top, qty) {
  const [a, b] = COLS[col];
  const cx = (a + b) / 2, cy = top + 4.6;
  if (qty && Number(qty) > 1) put(page, font, String(qty), cx - 3, b - 2, top + 8, 9);
  else check(page, cx, cy);
}
async function embed(doc, dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl || "");
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  return /png/i.test(m[1]) ? doc.embedPng(bytes) : doc.embedJpg(bytes);
}
function drawFit(page, img, x, yBottom, w, h) {
  const sc = Math.min(w / img.width, h / img.height);
  page.drawImage(img, { x: x + (w - img.width * sc) / 2, y: yBottom + (h - img.height * sc) / 2, width: img.width * sc, height: img.height * sc });
}
export function lastName(d) { return clean(d.customer?.last || String(d.customer?.name || "").trim().split(/\s+/).pop() || "Customer"); }
export function fullName(c) { return clean([c.first, c.last].filter(Boolean).join(" ")); }
export const balance = (d) => Math.round((Number(d.price || 0) - Number(d.deposit || 0)) * 100) / 100;
export const hasFoldingRail = (d) => !!d.extras?.foldingRail;
const turnsOf = (lift) => Math.max(0, (lift.flights || []).length - 1);
const sideWord = (s) => (s === "L" ? "LEFT" : "RIGHT");

export function liftSummary(lift, i) {
  const p = PRODUCTS[lift.product] || { label: lift.product };
  const lines = [`Lift ${i + 1}: ${p.label}${lift.flights.length > 1 ? ` (${lift.flights.length} flights)` : ""}`];
  lift.flights.forEach((f, j) => {
    const turn = j < lift.flights.length - 1 ? `, then turns ${f.turn === "L" ? "LEFT" : "RIGHT"}` : "";
    lines.push(`  ${lift.flights.length > 1 ? `Flight ${j + 1}: ` : ""}${f.steps} steps, ${f.width}" wide, ${f.length}" long, lift on ${sideWord(f.side)}${turn}`);
  });
  lines.push(`  Outlet: ${lift.outlet}`);
  return lines;
}

// ---------------- validation ----------------
export function validate(d) {
  const e = [];
  if (!d.jobNumber) e.push("Job #");
  if (!d.customer?.first || !d.customer?.last) e.push("customer name");
  if (!d.customer?.address) e.push("address");
  if (!(Number(d.price) > 0)) e.push("contract price");
  if (Number(d.deposit) < 0 || Number(d.deposit) > Number(d.price)) e.push("deposit (must be between $0 and the price)");
  if (!["Cash", "Finance"].includes(d.payType)) e.push("pay terms");
  const lifts = d.lifts || [];
  if (!lifts.length && !d.vpl && !d.extras?.scooter && !d.extras?.liftChair && !d.extras?.pollock) e.push("at least one product");
  lifts.forEach((l, i) => {
    if (!PRODUCTS[l.product]) e.push(`lift ${i + 1} model`);
    if (!l.outlet || !String(l.outlet).trim()) e.push(`lift ${i + 1} outlet location`);
    const max = PRODUCTS[l.product]?.kind === "curved" ? 3 : 1;
    if (!l.flights?.length || l.flights.length > max) e.push(`lift ${i + 1} flights`);
    (l.flights || []).forEach((f, j) => {
      if (!(Number(f.steps) > 0) || !(Number(f.width) > 0) || !(Number(f.length) > 0)) e.push(`lift ${i + 1} flight ${j + 1} steps/width/length`);
      if (!["L", "R"].includes(f.side)) e.push(`lift ${i + 1} flight ${j + 1} install side`);
      if (j < l.flights.length - 1 && !["L", "R"].includes(f.turn)) e.push(`lift ${i + 1} flight ${j + 1} turn direction`);
    });
  });
  if (lifts.length > 2) e.push("no more than 2 lifts per job");
  if (d.vpl && !VPLS[d.vpl]) e.push("VPL size");
  return e;
}

// ---------------- Agreement ----------------
export async function fillAgreement(d) {
  const doc = await PDFDocument.load(AGREEMENT_PDF);
  const page = doc.getPage(0);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const c = d.customer;
  const owners = [fullName(c), d.customer2 ? fullName(d.customer2) : ""].filter(Boolean).join(" & ");
  put(page, f, owners, 240, 458, 114.5);
  put(page, f, c.address, 332, 533, 145.6);
  put(page, f, c.city, 98, 268, 161.1);
  put(page, f, c.state, 309, 369, 161.1);
  put(page, f, c.zip, 416, 503, 161.1);
  put(page, f, c.phone, 90, 221, 176.7);
  put(page, f, c.alt, 274, 469, 176.7);
  put(page, f, c.email, 82, 472, 192.2);

  // "We are installing" lines
  const rowTops = [200.7, 217.0, 233.4, 249.7, 266.2, 282.5, 298.0, 313.6, 329.1, 344.6, 361.1];
  const qty = {};
  for (const l of d.lifts || []) { const r = PRODUCTS[l.product]?.agrRow; if (r !== undefined) qty[r] = (qty[r] || 0) + 1; }
  if (d.vpl) qty[1] = (qty[1] || 0) + 1; // Harmar Highlander = the VPL line
  if (d.extras?.scooter || d.extras?.liftChair) qty[5] = (d.extras.scooter ? 1 : 0) + (d.extras.liftChair ? 1 : 0);
  if (d.extras?.pollock) qty[9] = 1;
  if (hasFoldingRail(d)) qty[10] = (d.lifts || []).filter((l) => PRODUCTS[l.product]?.kind === "straight").length || 1;
  for (const [row, n] of Object.entries(qty)) {
    const top = rowTops[row];
    check(page, 99.5, top + 5);
    put(page, f, String(n), 226, 250, top + 8, 9.5);
  }
  // Warranty + price-includes-taxes: always YES
  check(page, 81.5, 382.3);
  check(page, 81.5, 397.9);

  // Additional items (notes): "Declined Folding Rail" unless folding rail sold
  const notes = [];
  if (!hasFoldingRail(d)) notes.push("Declined Folding Rail");
  if (d.vpl) notes.push(`${d.vpl} vertical platform lift (up to ${VPLS[d.vpl].max}")`);
  if (d.additionalItems) notes.push(clean(d.additionalItems));
  const lines = wrap(f, 9, notes.join(". ") + (notes.length ? "." : ""), 425);
  const extraLines = wrap(f, 9, lines.slice(1).join(" "), 495);
  if (lines[0]) put(page, f, lines[0], 126, 553, 416.5, 9);
  if (extraLines[0]) put(page, f, extraLines[0], 57, 553, 428.4, 9);
  if (extraLines[1]) put(page, f, extraLines[1], 57, 378, 440.3, 9);
  put(page, f, d.heightWeight, 463, 556, 440.3, 8.5);

  // Payment terms
  put(page, f, money(d.price), 128, 298, 468.1);
  put(page, f, money(d.deposit), 176, 297, 480.0);
  put(page, f, money(balance(d)), 133, 299, 491.9);
  put(page, f, d.installDate || "TBD", 397, 537, 468.1);
  put(page, f, d.payType, 376, 536, 480.0);
  put(page, f, d.jobNumber, 352, 537, 491.9);

  // Date line
  const dt = new Date((d.date || new Date().toISOString().slice(0, 10)) + "T12:00:00");
  put(page, f, dt.toLocaleString("en-US", { month: "long" }), 155, 273, 648.5, 10.5);
  put(page, f, String(dt.getDate()), 318, 366, 648.5, 10.5);
  put(page, f, String(dt.getFullYear()), 420, 492, 648.5, 10.5);

  // Signatures
  const sig = async (url, x0, x1) => { const img = await embed(doc, url); if (img) drawFit(page, img, x0, H - 676, x1 - x0, 30); };
  await sig(d.signatures?.rep, 70, 214);
  await sig(d.signatures?.owner1, 248, 381);
  await sig(d.signatures?.owner2, 408, 543);
  return doc;
}

// ---------------- Order sheet (Package Worksheet) ----------------
export async function fillOrderSheet(d) {
  const doc = await PDFDocument.load(ORDER_PDF);
  const page = doc.getPage(0);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const c = d.customer;
  const owners = [fullName(c), d.customer2 ? fullName(d.customer2) : ""].filter(Boolean).join(" & ");
  const row = (top) => top + 9.2; // baseline inside a header row
  put(page, f, owners, 67, 254, row(32.6));
  put(page, f, d.jobNumber, 304, 394, row(32.6));
  put(page, f, c.address, 67, 394, row(45.6));
  put(page, f, c.city, 67, 208, row(58.6));
  put(page, f, `${c.state || ""} ${c.zip || ""}`.trim(), 258, 394, row(58.6));
  put(page, f, c.phone, 67, 208, row(71.6));
  put(page, f, c.alt, 258, 394, row(71.6));
  put(page, f, c.email, 67, 394, row(84.6));
  const dt = new Date((d.date || "") + "T12:00:00");
  put(page, f, isNaN(dt) ? "" : dt.toLocaleDateString("en-US"), 67, 208, row(97.6));
  put(page, f, d.installDate || "TBD", 258, 394, row(97.6));
  put(page, f, d.repName || "CJ Dinsmore", 67, 300, row(110.6));

  // Top-right money
  put(page, f, money(d.price), 496, 589, row(32.6));
  put(page, f, money(d.deposit), 496, 589, row(45.6)); // Cash Down Pmt = deposit
  put(page, f, money(balance(d)), 496, 589, row(71.6));
  if (d.payType === "Cash") circle(page, 498, 540, 84.2, 95.8);
  else put(page, fb, "Finance", 497, 541, row(97.6), 8.5); // blank cell between Greensky and Genesis

  // Products
  for (const l of d.lifts || []) {
    const p = PRODUCTS[l.product];
    if (!p || !p.order) continue;
    if (p.order === "upmodular") { const t = UP_ROWS[Math.min(3, Math.max(1, turnsOf(l)))]; rowMark(page, f, "L", t); }
    else if (p.order === "freecurve") { const t = FREECURVE_ROWS[Math.min(2, Math.max(1, turnsOf(l)))]; rowMark(page, f, "M", t); }
    else rowMark(page, f, p.order.col, p.order.top);
  }
  // Two of the same straight lift: show quantity
  const sameStraight = {};
  for (const l of d.lifts || []) if (PRODUCTS[l.product]?.kind === "straight") sameStraight[l.product] = (sameStraight[l.product] || 0) + 1;
  for (const [k, n] of Object.entries(sameStraight)) if (n > 1) { const o = PRODUCTS[k].order; page.drawRectangle({ x: COLS[o.col][0] + 2, y: H - o.top - 10, width: COLS[o.col][1] - COLS[o.col][0] - 4, height: 11, color: rgb(1, 1, 1) }); rowMark(page, f, o.col, o.top, n); }

  if (d.vpl && VPLS[d.vpl]) rowMark(page, f, "L", VPLS[d.vpl].top);
  for (const [k, v] of Object.entries(d.vplFeatures || {})) if (v && VPL_FEATURES[k]) rowMark(page, f, "L", VPL_FEATURES[k].top, VPL_FEATURES[k].qty ? v : undefined);
  const ex = d.extras || {};
  for (const [k, v] of Object.entries(ex)) {
    const e = EXTRAS[k];
    if (!v || !e) continue;
    if (e.col) rowMark(page, f, e.col, e.top, e.qty ? v : undefined);
  }
  for (const size of d.grabBars || []) if (GRAB_BARS[size.size ?? size]) rowMark(page, f, "L", GRAB_BARS[size.size ?? size], size.qty);

  // Special notes on stairlifts (middle column write-in lines)
  const lifts = d.lifts || [];
  const meas = lifts.map((l, i) => l.flights.map((fl, j) => `${lifts.length > 1 ? `L${i + 1}` : ""}${l.flights.length > 1 ? `F${j + 1}` : ""}${lifts.length > 1 || l.flights.length > 1 ? ": " : ""}${fl.steps}st ${fl.width}"x${fl.length}"`).join(" / ")).join(" | ");
  const sides = lifts.map((l, i) => l.flights.map((fl, j) => `${lifts.length > 1 ? `L${i + 1}` : ""}${l.flights.length > 1 ? `F${j + 1}` : ""}${lifts.length > 1 || l.flights.length > 1 ? " " : ""}${sideWord(fl.side)}`).join(", ")).join(" | ");
  const outs = lifts.map((l, i) => `${lifts.length > 1 ? `L${i + 1}: ` : ""}${l.outlet}`).join(" | ");
  put(page, f, meas, 213, 345, 644.5, 7);
  put(page, f, sides, 213, 345, 666.5, 7);
  put(page, f, outs, 213, 345, 688.5, 7);
  if (ex.tallBrackets) put(page, f, "YES", 213, 345, 710.5, 8);
  if (ex.ext10) put(page, f, "YES", 213, 345, 732.5, 8);

  // Pricing reference box: product line + stair diagram(s)
  const box = { x: 398, top: 156, w: 190, bottom: 556 };
  let y = box.top + 12;
  const title = [];
  lifts.forEach((l) => { const steps = l.flights.reduce((s, fl) => s + Number(fl.steps || 0), 0); title.push(`${steps} steps - ${PRODUCTS[l.product]?.label || l.product}`); });
  if (d.vpl) title.push(`${d.vpl} (up to ${VPLS[d.vpl].max}")`);
  for (const t of title) { put(page, fb, t, box.x + 4, box.x + box.w - 4, y, 8.5); y += 11; }
  const areaH = box.bottom - y - 6;
  const per = lifts.length ? areaH / lifts.length : 0;
  lifts.forEach((l, i) => drawStairs(page, f, l, { x: box.x + 6, top: y + 4 + i * per, w: box.w - 12, h: per - 8 }, lifts.length > 1 ? `Lift ${i + 1}` : ""));

  // Notes box (bottom right)
  const notes = [];
  if (d.stopOnLastStep) notes.push("STOP ON THE LAST STEP");
  lifts.forEach((l, i) => notes.push(...liftSummary(l, i)));
  if (d.vpl) notes.push(`${d.vpl}: up to ${VPLS[d.vpl].max}"`);
  if (!hasFoldingRail(d) && lifts.some((l) => PRODUCTS[l.product]?.kind === "straight")) notes.push("Declined Folding Rail");
  if (d.heightWeight) notes.push(`Client height/weight: ${d.heightWeight}`);
  if (d.notes) notes.push(...String(d.notes).split("\n"));
  let ny = 581;
  for (const n of notes) {
    const bold = n === "STOP ON THE LAST STEP";
    for (const ln of wrap(bold ? fb : f, 8, n, 186)) {
      if (ny > 775) break;
      put(page, bold ? fb : f, ln, 400, 588, ny, 8);
      ny += 10;
    }
  }
  return doc;
}

/** Top-down stair plan. Flights go "up" the page; turns rotate 90°. Rail drawn on the install side. */
export function drawStairs(page, font, lift, area, label) {
  const fl = lift.flights;
  // Lay out in inch space with a turtle, then scale into the area.
  let dir = [0, -1]; // up the page (top-origin y grows downward)
  let pos = [0, 0];
  const shapes = [];
  fl.forEach((f, j) => {
    const W = Number(f.width) || 36, L = Number(f.length) || 120, n = Math.max(1, Number(f.steps) || 1);
    const right = [-dir[1], dir[0]];
    const corners = (len) => {
      const a = [pos[0] - right[0] * W / 2, pos[1] - right[1] * W / 2];
      const b = [pos[0] + right[0] * W / 2, pos[1] + right[1] * W / 2];
      return [a, b, [b[0] + dir[0] * len, b[1] + dir[1] * len], [a[0] + dir[0] * len, a[1] + dir[1] * len]];
    };
    const rect = corners(L);
    const treads = [];
    for (let k = 1; k < n; k++) {
      const t = (L * k) / n;
      const c0 = [pos[0] - right[0] * W / 2 + dir[0] * t, pos[1] - right[1] * W / 2 + dir[1] * t];
      const c1 = [pos[0] + right[0] * W / 2 + dir[0] * t, pos[1] + right[1] * W / 2 + dir[1] * t];
      treads.push([c0, c1]);
    }
    const sideSign = f.side === "L" ? -1 : 1;
    const off = (W / 2 - 3) * sideSign;
    const rail = [[pos[0] + right[0] * off, pos[1] + right[1] * off], [pos[0] + right[0] * off + dir[0] * L, pos[1] + right[1] * off + dir[1] * L]];
    shapes.push({ rect, treads, rail, start: [...pos], dir: [...dir], steps: n, flight: j });
    pos = [pos[0] + dir[0] * L, pos[1] + dir[1] * L];
    if (j < fl.length - 1) {
      // landing square, then turn
      const land = corners(W);
      shapes.push({ landing: land });
      pos = [pos[0] + dir[0] * W / 2, pos[1] + dir[1] * W / 2];
      dir = f.turn === "L" ? [dir[1], -dir[0]] : [-dir[1], dir[0]];
      pos = [pos[0] + dir[0] * W / 2, pos[1] + dir[1] * W / 2];
    }
  });
  const pts = shapes.flatMap((s) => s.rect || s.landing);
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
  const pad = 14;
  const sc = Math.min((area.w - pad * 2) / (maxX - minX || 1), (area.h - pad * 2 - (label ? 10 : 0)) / (maxY - minY || 1));
  const ox = area.x + (area.w - (maxX - minX) * sc) / 2 - minX * sc;
  const oy = area.top + (label ? 10 : 0) + (area.h - (label ? 10 : 0) - (maxY - minY) * sc) / 2 - minY * sc;
  const P = (p) => ({ x: ox + p[0] * sc, y: H - (oy + p[1] * sc) });
  const poly = (ps, w = 0.9, color = BLACK) => ps.forEach((p, i) => page.drawLine({ start: P(p), end: P(ps[(i + 1) % ps.length]), thickness: w, color }));
  if (label) put(page, font, label, area.x, area.x + area.w, area.top + 7, 7.5, GREY);
  for (const s of shapes) {
    if (s.landing) { poly(s.landing, 0.9); continue; }
    poly(s.rect, 1.1);
    for (const [a, b] of s.treads) page.drawLine({ start: P(a), end: P(b), thickness: 0.7, color: rgb(0.3, 0.3, 0.35) });
    page.drawLine({ start: P(s.rail[0]), end: P(s.rail[1]), thickness: 2.6, color: INK });
    // UP arrow + step count in the middle of the flight
    const L = Math.hypot(s.rect[3][0] - s.rect[0][0], s.rect[3][1] - s.rect[0][1]);
    const mid = [s.start[0] + s.dir[0] * L * 0.5, s.start[1] + s.dir[1] * L * 0.5];
    const a0 = P([mid[0] - s.dir[0] * L * 0.18, mid[1] - s.dir[1] * L * 0.18]);
    const a1 = P([mid[0] + s.dir[0] * L * 0.18, mid[1] + s.dir[1] * L * 0.18]);
    page.drawLine({ start: a0, end: a1, thickness: 0.9, color: BLACK });
    const ang = Math.atan2(a1.y - a0.y, a1.x - a0.x);
    for (const da of [2.6, -2.6]) page.drawLine({ start: a1, end: { x: a1.x - 5 * Math.cos(ang + da / 6), y: a1.y - 5 * Math.sin(ang + da / 6) }, thickness: 0.9, color: BLACK });
    const lab = `${s.steps} steps`;
    const lp = P(mid);
    const horiz = Math.abs(s.dir[0]) > 0.5;
    page.drawText(lab, { x: lp.x + (horiz ? -font.widthOfTextAtSize(lab, 6.5) / 2 : 5), y: lp.y + (horiz ? 5 : -2), size: 6.5, font, color: GREY });
  }
  // Outlet marker at the bottom of the first flight, on the rail side
  const s0 = shapes[0];
  const ob = P(s0.rail[0]);
  page.drawCircle({ x: ob.x, y: ob.y, size: 2.6, color: INK });
  put(page, font, `Outlet: ${lift.outlet || ""}`, area.x, area.x + area.w, H - ob.y + 11, 6.5, INK);
}

// ---------------- Packet ----------------
/** photos: [{ dataUrl, caption }] ; idPhoto: dataUrl (optional, finance only) */
export async function buildPacket(d, { photos = [], idPhoto = null } = {}) {
  const out = await PDFDocument.create();
  out.setTitle(`${d.jobNumber}: ${lastName(d)}`);
  out.setProducer("HomePro Field App");
  const agr = await fillAgreement(d);
  const ord = await fillOrderSheet(d);
  for (const src of [agr, ord]) {
    const [p] = await out.copyPages(src, [0]);
    out.addPage(p);
  }
  const f = await out.embedFont(StandardFonts.Helvetica);
  const fb = await out.embedFont(StandardFonts.HelveticaBold);
  const imgPage = async (dataUrl, caption) => {
    const img = await embed(out, dataUrl);
    if (!img) return;
    const p = out.addPage([612, 792]);
    p.drawText(clean(`${d.jobNumber}: ${lastName(d)} - ${caption}`), { x: 36, y: 760, size: 11, font: fb, color: BLACK });
    drawFit(p, img, 36, 36, 540, 710);
  };
  for (let i = 0; i < photos.length; i++) await imgPage(photos[i].dataUrl, photos[i].caption || `Staircase photo ${i + 1}`);
  if (idPhoto) await imgPage(idPhoto, "Customer ID (financing)");
  void f;
  return out.save();
}
