// OMEGA_LOCAL=1 MAIL_TEST=1 SESSION_SECRET=dev APP_PIN=123456 GHL_TOKEN=x GHL_LOCATION_ID=LOC node test/e2e.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { server, calls, opps, contacts, tasks } from "./server.mjs";
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
assert.match(cfg.smsConsentText, /Reply STOP/);
assert.equal((await call("/contacts?q=liv")).contacts[0].lastName, "Livingston");

const sig = "data:image/png;base64," + fs.readFileSync("test/sig.png").toString("base64");
const jpg = "data:image/jpeg;base64," + fs.readFileSync("test/stairs.jpg").toString("base64");
const ph = (await call("/photo", { dataUrl: jpg })).key;
const idk = (await call("/photo", { dataUrl: jpg })).key;
assert.ok(ph && idk);

// Lead with a follow-up day and enough filled in for an unsigned quote copy
calls.length = 0;
const fu = new Date(cfg.today + "T12:00:00Z"); fu.setUTCDate(fu.getUTCDate() + 3);
const followUpDate = fu.toISOString().slice(0, 10);
const leadDeal = { customer: { first: "Bob", last: "Buyer", phone: "8435550111", address: "", city: "", state: "SC", zip: "" }, lifts: [{ product: "is350", outlet: "", flights: [{ steps: 13, width: 36, length: 150, side: "L" }] }], extras: {}, leadNotes: "Wants to talk to his son first", price: 4999, smsConsent: true, smsConsentAt: "2026-11-05T19:00:00Z" };
assert.match((await call("/lead", { deal: { ...leadDeal, followUpDate: "2020-01-01" } })).error, /follow-up day/);
const lead = await call("/lead", { deal: { ...leadDeal, followUpDate }, photos: [{ key: ph, caption: "Stairs" }] });
assert.equal(lead.ok, true, JSON.stringify(lead));
assert.ok(lead.ghl.log.every((s) => s.ok), JSON.stringify(lead.ghl.log));
assert.equal(lead.followUp.date, followUpDate);
assert.equal(tasks.length, 1, "one follow-up task");
assert.match(tasks[0].title, /^Follow up: Bob Buyer - Harmar Indigo IS350$/);
assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(new Date(tasks[0].dueDate)).replace(",", ""), `${followUpDate} 09:00`, "task due 9:00 AM Eastern on the follow-up day");
const cfv = Object.fromEntries(contacts.c1.customFields.map((x) => [x.id, x.value]));
assert.equal(cfv.cf0, followUpDate, "Follow-Up Date on the contact");
assert.equal(cfv.cf1, "Harmar Indigo IS350", "Follow-Up Product on the contact");
assert.match(cfv.cf2, /Quoted \$4,999\.00\. Wants to talk to his son first/);
assert.ok(cfv.cf3, "Quote Packet file on the contact");
assert.ok(opps.o1.customFields.some((x) => x.fieldValue === followUpDate), "Follow-Up Date on the opportunity");
assert.ok(lead.ghl.log.some((x) => x.step === "Attach unsigned quote to the opportunity" && x.ok));
assert.ok(calls.some((c) => c.path.endsWith("/tags") && c.body.tags.includes("follow-up-scheduled")));
assert.ok(calls.some((c) => c.path.endsWith("/notes") && c.body.body.includes("Unsigned quote copy: http")));
const qRes = await fetch(base.replace("/api", "") + new URL(lead.link).pathname + new URL(lead.link).search);
const qDoc = await PDFDocument.load(await qRes.arrayBuffer());
assert.equal(qDoc.getPageCount(), 3, "quote copy = agreement + order sheet + 1 photo");
// A bare lead (name + phone only) still saves, with no quote copy
const bare = await call("/lead", { deal: { customer: { first: "Nina", last: "Noquote", phone: "8435550112" }, lifts: [], extras: {}, followUpDate } });
assert.equal(bare.ok, true); assert.equal(bare.link, null);
assert.ok(bare.ghl.log.every((s) => s.ok), JSON.stringify(bare.ghl.log));
delete opps.o2; // keep the opportunity numbering below unchanged
assert.equal(opps.o1.pipelineStageId, "s3", "lead lands in Quoted - Following Up");
assert.ok(calls.some((c) => c.path.endsWith("/tags") && c.body.tags.includes("sms-consent")), "sms-consent tag");
assert.ok(calls.some((c) => c.path.endsWith("/notes") && /SMS CONSENT[\s\S]*Nov 5, 2026[\s\S]*CJ Dinsmore about my stairlift/.test(c.body.body)), "consent note");
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
// Customer copy: a separate email with the signed agreement only
assert.equal(r.customerCopy.ok, true, JSON.stringify(r.customerCopy));
assert.equal(r.customerCopy.to, "bob@example.com");
assert.deepEqual(r.customerCopy.test.to.map((x) => x.address), ["bob@example.com"]);
assert.equal(r.customerCopy.test.attachments.length, 1);
assert.equal(r.customerCopy.test.attachments[0].filename, "HomePro Agreement Buyer.pdf");
assert.equal((await PDFDocument.load(Buffer.from(r.customerCopy.test.attachments[0].content, "base64"))).getPageCount(), 1, "customer gets the agreement page only");
assert.match(r.customerCopy.test.text, /Balance due: \$4,999\.00 \(Finance\)/);
assert.ok(calls.some((c) => c.path.endsWith("/notes") && /Signed agreement emailed to the customer/.test(c.body.body)));

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
// No email on file -> the deal still goes through, with no customer copy, and it says why
const noMail = await call("/deal", { deal: { ...deal, jobNumber: "MYR282SL", customer: { ...deal.customer, first: "Ann", last: "Nomail", email: "" } }, photos: [{ key: ph }] });
assert.equal(noMail.email.ok, true);
assert.equal(noMail.customerCopy.ok, false);
assert.match(noMail.customerCopy.skipped, /No customer email/);
console.log("ALL E2E CHECKS PASSED");
server.close(); process.exit(0);
