import fs from "node:fs";
import assert from "node:assert/strict";
import { buildPacket, validate, balance } from "../lib/docs.mjs";
fs.mkdirSync("test/out", { recursive: true });
const sig = "data:image/png;base64," + fs.readFileSync("test/sig.png").toString("base64");
const photo = "data:image/jpeg;base64," + fs.readFileSync("test/stairs.jpg").toString("base64");

const straight = {
  jobNumber: "MYR281SL", date: "2026-11-04", installDate: "TBD", repName: "CJ Dinsmore",
  customer: { first: "Jane", last: "Sample", address: "3841 Panther Path", city: "Timmonsville", state: "SC", zip: "29161", phone: "(410) 555-0100", alt: "", email: "jane@example.com" },
  heightWeight: "5'6\" / 180 lbs",
  lifts: [{ product: "is350", outlet: "Bottom of stairs, left wall", flights: [{ steps: 14, width: 36, length: 168, side: "R" }] }],
  extras: { outlet: true }, grabBars: [], vpl: "", vplFeatures: {},
  stopOnLastStep: true, additionalItems: "", notes: "Customer prefers morning install.",
  price: 4999, deposit: 500, payType: "Cash",
  signatures: { rep: sig, owner1: sig, owner2: null },
};
assert.deepEqual(validate(straight), []);
assert.equal(balance(straight), 4499);
fs.writeFileSync("test/out/straight.pdf", await buildPacket(straight, { photos: [{ dataUrl: photo, caption: "Bottom of stairs" }] }));

const curved = {
  ...straight, jobNumber: "MYR290CV", payType: "Finance", price: 16500, deposit: 0, stopOnLastStep: false,
  customer: { ...straight.customer, first: "Dashannon", last: "Livingston" },
  lifts: [{ product: "freecurve", outlet: "Bottom landing, right wall", flights: [
    { steps: 3, width: 36, length: 30, side: "R", turn: "L" },
    { steps: 12, width: 36, length: 125, side: "R", turn: "R" },
    { steps: 2, width: 36, length: 20, side: "R" }] }],
  extras: { foldingRail: false, tallBrackets: true }, grabBars: [{ size: 24, qty: 2 }],
};
assert.deepEqual(validate(curved), []);
fs.writeFileSync("test/out/curved.pdf", await buildPacket(curved, { photos: [{ dataUrl: photo, caption: "Stairs" }], idPhoto: photo }));

const two = { ...straight, jobNumber: "MYR300SL", price: 9998, deposit: 1000, extras: { foldingRail: true, extraRail: 2 }, vpl: "VPL600", vplFeatures: { topGate: true, callSends: 2 },
  lifts: [straight.lifts[0], { product: "is350", outlet: "Top landing hall outlet", flights: [{ steps: 6, width: 32, length: 72, side: "L" }] }] };
assert.deepEqual(validate(two), []);
fs.writeFileSync("test/out/two-lifts.pdf", await buildPacket(two));
assert.ok(validate({ ...straight, lifts: [{ ...straight.lifts[0], outlet: "" }] }).some((e) => e.includes("outlet")));
console.log("ok");
