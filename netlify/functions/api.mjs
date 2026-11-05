// HomePro Field App API: /api/*
import { randomUUID, timingSafeEqual } from "node:crypto";
import { getStore } from "../../lib/blobs.mjs";
import * as ghl from "../../lib/ghl.mjs";
import { sendPacket, recipients } from "../../lib/mail.mjs";
import { checkPin, issueToken, validToken, sign } from "../../lib/auth.mjs";
import { buildPacket, validate, balance, lastName, fullName, liftSummary, hasFoldingRail, PRODUCTS, VPLS, VPL_FEATURES, EXTRAS, GRAB_BARS } from "../../lib/docs.mjs";

// Exact wording the customer agrees to in person (shown in the app, recorded in GHL, and shown on cjdinsmore.com/sms-consent).
export const SMS_CONSENT_TEXT = "I agree to receive text messages from CJ Dinsmore about my stairlift quote, appointments, installation, and related offers. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.";
const json = (d, status = 200) => Response.json(d, { status });
const fail = (msg, status = 400) => json({ error: msg }, status);
const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const photos = () => getStore({ name: "photos", consistency: "strong" });
const packets = () => getStore({ name: "packets", consistency: "strong" });
const safe = (s) => String(s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40);

const GHL_PRODUCT = {
  is350: "Harmar Indigo IS350", sl600hd: "Harmar SL600HD", hc1000out: "Handicare 1000 Outdoor", helix: "Harmar Helix Curved",
  upmodular: "Harmar UP Modular Curved", freecurve: "Handicare Freecurve", hc4000: "Handicare 4000 Curved",
};

function productsFor(d) {
  const set = new Set((d.lifts || []).map((l) => GHL_PRODUCT[l.product]).filter(Boolean));
  if (d.vpl) set.add("Harmar VPL");
  if (d.extras?.scooter) set.add("Pride Scooter");
  if (d.extras?.liftChair) set.add("Pride Lift Chair");
  if (d.extras?.pollock) set.add("Pollock Elevator");
  return [...set];
}
function oppName(d) {
  const what = (d.lifts || []).map((l) => PRODUCTS[l.product]?.label.replace(/^(Harmar|Handicare) /, "")).join(" + ") || (d.vpl ? d.vpl : "Stairlift");
  return `${fullName(d.customer)} - ${what}`;
}
function dealFields(d, extra = {}) {
  const lifts = d.lifts || [];
  return {
    "Job Number": d.jobNumber || undefined,
    "Sale Date": d.date || todayET(),
    "Install Date": d.installDate || "TBD",
    Products: productsFor(d),
    "Number of Lifts": lifts.length,
    "Contract Price": Number(d.price) || undefined,
    Deposit: Number(d.deposit) || 0,
    "Balance Due": balance(d),
    "Pay Terms": d.payType || undefined,
    "Folding Rail": lifts.length ? (hasFoldingRail(d) ? "Sold" : "Declined") : undefined,
    "Stop on Last Step": d.stopOnLastStep ? "Yes" : "No",
    "Outlet Location": lifts.map((l, i) => `${lifts.length > 1 ? `Lift ${i + 1}: ` : ""}${l.outlet}`).join(" | ") || undefined,
    "Staircase Details": lifts.flatMap((l, i) => liftSummary(l, i)).join("\n") || undefined,
    "Client Height and Weight": d.heightWeight || undefined,
    ...extra,
  };
}

async function loadPhotos(list) {
  const out = [];
  for (const p of list || []) {
    const v = await photos().get(String(p.key || ""), { type: "text" });
    if (v) out.push({ dataUrl: v, caption: p.caption });
  }
  return out;
}

async function savePacket(req, d, pdf) {
  const key = `${safe(d.jobNumber)}/${Date.now()}-${safe(d.jobNumber)}-${safe(lastName(d))}.pdf`;
  await packets().set(key, pdf, { metadata: { name: `${d.jobNumber} ${lastName(d)}.pdf` } });
  return { key, link: `${new URL(req.url).origin}/api/file?k=${encodeURIComponent(key)}&s=${sign("file:" + key)}` };
}

/** Contact + opportunity in GHL. Never throws: returns a log of steps. */
async function syncGhl(d, mode, { packetPdf, packetLink } = {}) {
  const log = [];
  const step = async (name, fn) => { try { const r = await fn(); log.push({ step: name, ok: true }); return r; } catch (e) { log.push({ step: name, ok: false, error: String(e.message || e).slice(0, 400) }); return null; } };
  const contactId = await step("Save customer contact", () => ghl.upsertContact(d.customer));
  if (!contactId) return { log };
  if (d.smsConsent) {
    const when = new Date(d.smsConsentAt || Date.now()).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET";
    await step("Record SMS consent", async () => {
      await ghl.addTags(contactId, ["sms-consent"]);
      await ghl.addNote(contactId, `SMS CONSENT (in person, HomePro field app)\nCustomer: ${fullName(d)}\nMobile: ${d.customer.phone || "(none entered)"}\nChecked by customer: ${when}\nRep: CJ Dinsmore\nWording agreed to: "${SMS_CONSENT_TEXT}"`);
    });
  }
  const sales = await step("Find Sales Pipeline", () => ghl.stage(["Sales Pipeline"], mode === "deal" ? ["Sold"] : ["Quoted - Following Up", "Quoted", "Contacted"]));
  let oppId = null, missing = [];
  if (mode === "lead") {
    const r = await step("Save lead opportunity", async () => {
      const existing = sales && await ghl.findOpenOpp(contactId, sales.pipelineId);
      const f = { ...dealFields(d), "Lead Notes": d.leadNotes || d.notes || undefined };
      return existing
        ? ghl.updateOpp(existing.id, { pipelineId: sales.pipelineId, stageId: sales.stageId, value: Number(d.price) || undefined, fieldsByName: f })
        : ghl.createOpp({ contactId, pipelineId: sales.pipelineId, stageId: sales.stageId, name: oppName(d), value: Number(d.price) || 0, fieldsByName: f });
    });
    oppId = r?.id; missing = r?.missing || [];
    await step("Tag contact", () => ghl.addTags(contactId, ["stairlift-lead"]));
    if (d.leadNotes || d.notes) await step("Add note", () => ghl.addNote(contactId, `Lead (in-home quote${d.price ? ` ${Number(d.price).toLocaleString("en-US", { style: "currency", currency: "USD" })}` : ""}): ${d.leadNotes || d.notes}`));
    return { log, contactId, oppId, missing, stage: sales?.stageName };
  }
  // Deal: close out the sales opportunity, open one in the Deal Pipeline
  if (sales) await step("Mark sales opportunity Sold", async () => {
    const existing = await ghl.findOpenOpp(contactId, sales.pipelineId);
    if (existing) await ghl.updateOpp(existing.id, { stageId: sales.stageId, status: "won" });
  });
  const deal = await step("Find Deal Pipeline", () => ghl.stage(["Deal Pipeline", "Deal"], ["Sold - Packet Sent", "Sold"]));
  if (deal) {
    const r = await step("Create deal opportunity", async () => {
      const existing = await ghl.findOpenOpp(contactId, deal.pipelineId);
      const f = dealFields(d, { "Packet Emailed": d._emailed ? "Yes" : "No" });
      return existing
        ? ghl.updateOpp(existing.id, { stageId: deal.stageId, value: Number(d.price), name: oppName(d), fieldsByName: f })
        : ghl.createOpp({ contactId, pipelineId: deal.pipelineId, stageId: deal.stageId, name: oppName(d), value: Number(d.price), fieldsByName: f });
    });
    oppId = r?.id; missing = r?.missing || [];
    if (oppId && packetPdf) {
      await step("Attach job packet", async () => {
        const x = await ghl.attachFile(oppId, "Job Packet", `${safe(d.jobNumber)}-${safe(lastName(d))}.pdf`, packetPdf, "application/pdf");
        if (!x.attached) throw new Error(`${x.error}${x.stored ? " | GHL now holds: " + JSON.stringify(x.stored).slice(0, 300) : ""}`);
        console.log("job packet attached using format:", x.format);
        return x;
      });
    }
  }
  await step("Tag contact", () => ghl.addTags(contactId, ["stairlift-sold"]));
  await step("Add note", () => ghl.addNote(contactId, `SOLD ${d.jobNumber}: ${Number(d.price).toLocaleString("en-US", { style: "currency", currency: "USD" })} ${d.payType}, deposit ${Number(d.deposit || 0).toLocaleString("en-US", { style: "currency", currency: "USD" })}.${packetLink ? `\nJob packet: ${packetLink}` : ""}`));
  return { log, contactId, oppId, missing, stage: deal?.stageName };
}

function dealErrors(d, photoCount) {
  const e = validate(d);
  if (!d.signatures?.rep) e.push("your signature");
  if (!d.signatures?.owner1) e.push("homeowner signature");
  if (d.customer2 && !d.signatures?.owner2) e.push("second homeowner signature");
  if ((d.lifts || []).length && photoCount < 1) e.push("at least one staircase photo");
  return e;
}

async function handleDeal(req, b, previewOnly) {
  const d = { ...b.deal, date: b.deal?.date || todayET() };
  const ph = await loadPhotos(b.photos);
  const id = b.idPhoto?.key && d.payType === "Finance" ? await photos().get(String(b.idPhoto.key), { type: "text" }) : null;
  if (!previewOnly) {
    const errs = dealErrors(d, ph.length);
    if (errs.length) return fail("Still needed: " + errs.join(", "));
  }
  const pdf = await buildPacket(d, { photos: ph, idPhoto: id });
  if (previewOnly) return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="preview.pdf"` } });

  const subject = `${d.jobNumber}: ${lastName(d)}`;
  const saved = await savePacket(req, d, pdf).catch(() => null);
  const link = saved?.link || null;
  let email = { ok: false };
  try {
    const r = await sendPacket({
      subject, filename: `${safe(d.jobNumber)} ${safe(lastName(d))}.pdf`, pdf,
      text: `${subject}\n\nAttached: signed agreement, order sheet and staircase photos${id ? " (with ID for financing)" : ""}.\n\n${fullName(d.customer)}\n${d.customer.address}, ${d.customer.city}, ${d.customer.state} ${d.customer.zip}\n${d.customer.phone || ""}\n\nContract ${Number(d.price).toLocaleString("en-US", { style: "currency", currency: "USD" })} - ${d.payType} - deposit ${Number(d.deposit || 0).toLocaleString("en-US", { style: "currency", currency: "USD" })}\n\nCJ Dinsmore\nHomePro Mobility`,
    });
    email = { ok: true, to: recipients(), subject, test: r.test };
  } catch (e) { email = { ok: false, error: String(e.message || e).slice(0, 300) }; }
  d._emailed = email.ok;
  const g = await syncGhl(d, "deal", { packetPdf: pdf, packetLink: link });
  return json({ ok: true, email, link, packetKey: saved?.key || null, subject, oppId: g.oppId || null, ghl: g });
}

async function serveFile(url) {
  const k = url.searchParams.get("k") || "", s = url.searchParams.get("s") || "";
  const want = sign("file:" + k);
  if (s.length !== want.length || !timingSafeEqual(Buffer.from(s), Buffer.from(want))) return new Response("Not found", { status: 404 });
  const e = await packets().getWithMetadata(k, { type: "arrayBuffer" });
  if (!e) return new Response("Not found", { status: 404 });
  const disp = url.searchParams.get("dl") === "1" ? "attachment" : "inline";
  return new Response(e.data, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${disp}; filename="${e.metadata?.name || "packet.pdf"}"` } });
}

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  try {
    if (path === "/file") return await serveFile(url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (path === "/login" && req.method === "POST") {
      if (!checkPin(body.pin)) { await new Promise((r) => setTimeout(r, 700)); return fail("Wrong PIN", 401); }
      return json({ token: issueToken() });
    }
    if (!validToken((req.headers.get("authorization") || "").replace(/^Bearer /, ""))) return fail("Please log in again", 401);

    if (path === "/config") return json({
      today: todayET(), recipients: recipients(),
      products: Object.fromEntries(Object.entries(PRODUCTS).map(([k, v]) => [k, { label: v.label, kind: v.kind }])),
      vpls: VPLS, vplFeatures: Object.fromEntries(Object.entries(VPL_FEATURES).map(([k, v]) => [k, { label: v.label, qty: !!v.qty }])),
      extras: Object.fromEntries(Object.entries(EXTRAS).map(([k, v]) => [k, { label: v.label, qty: !!v.qty }])),
      grabBars: Object.keys(GRAB_BARS).map(Number),
      smsConsentText: SMS_CONSENT_TEXT,
    });
    if (path === "/contacts") { const q = (url.searchParams.get("q") || "").trim(); return json({ contacts: q.length < 2 ? [] : await ghl.searchContacts(q) }); }
    if (path === "/photo" && req.method === "POST") {
      if (!/^data:image\/(jpeg|png);base64,/.test(body.dataUrl || "")) return fail("Not an image");
      if (body.dataUrl.length > 5_500_000) return fail("Photo too large");
      const key = randomUUID();
      await photos().set(key, body.dataUrl);
      return json({ key });
    }
    if (path === "/lead" && req.method === "POST") {
      const d = { ...body.deal, date: body.deal?.date || todayET() };
      if (!d.customer?.first || !d.customer?.last) return fail("Enter the customer's first and last name");
      if (!d.customer?.phone && !d.customer?.email) return fail("Enter a phone number or email");
      const g = await syncGhl(d, "lead");
      return json({ ok: true, ghl: g });
    }
    if (path === "/deal" && req.method === "POST") return await handleDeal(req, body, false);
    if (path === "/debug/opp") {
      const id = url.searchParams.get("id") || "";
      const o = await ghl.getOpp(id);
      return json({ id: o.id, name: o.name, pipelineId: o.pipelineId, stageId: o.pipelineStageId, jobPacketFieldId: await ghl.fieldId("Job Packet"), customFields: o.customFields });
    }
    if (path === "/attach" && req.method === "POST") {
      // Re-attach a saved packet to an opportunity (for jobs submitted before attachment worked)
      const e = await packets().getWithMetadata(String(body.packetKey || ""), { type: "arrayBuffer" });
      if (!e) return fail("Packet not found", 404);
      return json(await ghl.attachFile(String(body.oppId || ""), "Job Packet", e.metadata?.name || "packet.pdf", Buffer.from(e.data), "application/pdf"));
    }
    if (path === "/resend" && req.method === "POST") {
      const key = String(body.packetKey || "");
      const e = await packets().getWithMetadata(key, { type: "arrayBuffer" });
      if (!e) return fail("Packet not found", 404);
      const subject = String(body.subject || e.metadata?.name || "Job packet").replace(/\.pdf$/, "");
      try {
        await sendPacket({ subject, filename: e.metadata?.name || "packet.pdf", pdf: Buffer.from(e.data), text: `${subject}\n\nAttached: signed agreement, order sheet and staircase photos.\n\nCJ Dinsmore\nHomePro Mobility` });
      } catch (err) { return json({ ok: false, error: String(err.message || err).slice(0, 300) }); }
      if (body.oppId) await ghl.updateOpp(body.oppId, { fieldsByName: { "Packet Emailed": "Yes" } }).catch(() => {});
      return json({ ok: true, subject, to: recipients() });
    }
    if (path === "/preview" && req.method === "POST") return await handleDeal(req, body, true);
    return fail("Not found", 404);
  } catch (e) {
    console.error(e);
    return fail(e.message || "Something went wrong", 500);
  }
};

export const config = { path: "/api/*" };
