// OMEGA_LOCAL=1 MAIL_TEST=1 SESSION_SECRET=dev APP_PIN=123456 GHL_TOKEN=x GHL_LOCATION_ID=LOC node test/e2e.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { server, calls, opps } from "./server.mjs";
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/api`;
let token;
const call = async (p, body, raw) => {
  const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return r;
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
assert.equal((await call("/login", { pin: "000000" })).status, 401);
token = (await call("/login", { pin: "123456" })).token;
assert.ok(token);
const cfg = await call("/config");
assert.equal(cfg.recipients.length, 4);
assert.equal((await call("/contacts?q=liv")).contacts[0].lastName, "Livingston");

const sig = "data:image/png;base64," + fs.readFileSync("test/sig.png").toString("base64");
const jpg = "data:image/jpeg;base64," + fs.readFileSync("test/stairs.jpg").toString("base64");
const ph = (await call("/photo", { dataUrl: jpg })).key;
const idk = (await call("/photo", { dataUrl: jpg })).key;
assert.ok(ph && idk);

// Lead
calls.length = 0;
const lead = await call("/lead", { deal: { customer: { first: "Bob", last: "Buyer", phone: "8435550111", address: "", city: "", state: "SC", zip: "" }, lifts: [], extras: {}, leadNotes: "Wants to talk to his son first", price: 4999 } });
assert.equal(lead.ok, true, JSON.stringify(lead));
assert.ok(lead.ghl.log.every((s) => s.ok), JSON.stringify(lead.ghl.log));
assert.equal(opps.o1.pipelineStageId, "s3", "lead lands in Quoted - Following Up");
console.log("lead ok");

// Deal (financed, with ID)
const deal = {
  jobNumber: "MYR281SL", installDate: "TBD", customer: { first: "Bob", last: "Buyer", address: "9 Harbor Rd", city: "Mount Pleasant", state: "SC", zip: "29464", phone: "8435550111", email: "bob@example.com" },
  lifts: [{ product: "is350", outlet: "Bottom left wall", flights: [{ steps: 14, width: 36, length: 168, side: "R" }] }], extras: {}, grabBars: [], vplFeatures: {},
  stopOnLastStep: true, price: 4999, deposit: 0, payType: "Finance", signatures: { rep: sig, owner1: sig },
};
assert.match((await call("/deal", { deal: { ...deal, signatures: { rep: sig } }, photos: [{ key: ph }] })).error, /homeowner signature/);
calls.length = 0;
const r = await call("/deal", { deal, photos: [{ key: ph, caption: "Stairs" }], idPhoto: { key: idk } });
assert.equal(r.ok, true, JSON.stringify(r));
assert.equal(r.email.ok, true, JSON.stringify(r.email));
assert.equal(r.email.subject, "MYR281SL: Buyer");
assert.equal(r.email.test.to.length, 4);
assert.equal(r.email.test.attachments[0].filename, "MYR281SL Buyer.pdf");
assert.ok(r.ghl.log.every((s) => s.ok), JSON.stringify(r.ghl.log, null, 1));
assert.deepEqual(r.ghl.missing, []);
assert.equal(opps.o1.status, "won", "sales opp marked won");
const d = Object.values(opps).find((o) => o.pipelineId === "deal");
assert.equal(d.pipelineStageId, "d1");
const f = Object.fromEntries(d.customFields.map((x) => [x.id, x.fieldValue]));
assert.equal(f.f0, "MYR281SL"); assert.deepEqual(f.f3, ["Harmar Indigo IS350"]); assert.equal(f.f8, "Finance"); assert.equal(f.f9, "Declined"); assert.equal(f.f10, "Yes"); assert.equal(f.f15, "Yes");
const pdfRes = await fetch(base.replace("/api", "") + new URL(r.link).pathname + new URL(r.link).search);
assert.equal(pdfRes.headers.get("content-type"), "application/pdf");
const pdf = Buffer.from(await pdfRes.arrayBuffer());
fs.mkdirSync("test/out", { recursive: true }); fs.writeFileSync("test/out/e2e-packet.pdf", pdf);
console.log("deal ok, packet", pdf.length, "bytes");
// Preview
const pv = await call("/preview", { deal, photos: [{ key: ph }] }, true);
assert.equal(pv.headers.get("content-type"), "application/pdf");
assert.ok(r.packetKey && r.subject === "MYR281SL: Buyer");
const rs = await call("/resend", { packetKey: r.packetKey, subject: r.subject, oppId: r.oppId });
assert.equal(rs.ok, true, JSON.stringify(rs));
const dl = await fetch(base.replace("/api", "") + new URL(r.link).pathname + new URL(r.link).search + "&dl=1");
assert.match(dl.headers.get("content-disposition"), /^attachment/);
const att = r.ghl.log.find((x) => x.step === "Attach job packet");
assert.equal(att.ok, true);
const dbg = await call("/debug/opp?id=" + r.oppId);
assert.ok(dbg.customFields.find((x) => x.id === dbg.jobPacketFieldId)?.fieldValue, "packet stored in Job Packet field");
console.log("ALL E2E CHECKS PASSED");
server.close(); process.exit(0);
