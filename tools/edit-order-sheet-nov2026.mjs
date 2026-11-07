// One-off: apply HomePro's Nov 2026 order-sheet wording to the vector template (row layout unchanged).
//   1st Pinnacle row "SL600 Indoor Straight 15.4FT" -> blank
//   IS350 row -> "Indigo IS350 Indoor Straight 15.4FT"
//   "SL300/600 Folding Rail Option" -> "Indigo IS350 Folding Rail Option"
import fs from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
const src = process.argv[2], out = process.argv[3];
const doc = await PDFDocument.load(fs.readFileSync(src));
const page = doc.getPage(0), H = page.getHeight();
const font = await doc.embedFont(StandardFonts.Helvetica);
const SIZE = 8.19, X = 210.1;
// [textTop, textBottom] in top-down coordinates from pdftotext
const rows = { sl600: [532.0, 541.9], is350: [558.2, 568.0], fold: [571.3, 581.1] };
const white = ([t, b]) => page.drawRectangle({ x: 209.3, y: H - b, width: 134, height: b - t, color: rgb(1, 1, 1) });
const write = ([t, b], s) => page.drawText(s, { x: X, y: H - b + 2.6, size: SIZE, font, color: rgb(0, 0, 0) });
for (const r of Object.values(rows)) white(r);
write(rows.is350, "Indigo IS350 Indoor Straight 15.4FT");
write(rows.fold, "Indigo IS350 Folding Rail Option");
doc.setTitle("Mobility & Accessibility Solutions - Package Worksheet (Nov 2026)");
fs.writeFileSync(out, await doc.save());
console.log("wrote", out);
