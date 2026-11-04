// GoHighLevel API v2 client for the HomePro sub-account.
// Field and pipeline IDs are looked up by NAME at runtime, so renaming nothing in GHL is required.
import { randomUUID } from "node:crypto";

const BASE = "https://services.leadconnectorhq.com";
const env = (k) => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);
export const loc = () => { const v = env("GHL_LOCATION_ID"); if (!v) throw new Error("GHL_LOCATION_ID is not set in Netlify"); return v; };

export class GhlError extends Error {
  constructor(status, body, path) {
    super(`GHL ${status} on ${path}: ${typeof body === "string" ? body : JSON.stringify(body)}`.slice(0, 600));
    this.status = status;
  }
}

async function req(method, path, { query, body, form } = {}) {
  const token = env("GHL_TOKEN");
  if (!token) throw new Error("GHL_TOKEN is not set in Netlify");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  const headers = { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json", "User-Agent": "HomeProFieldApp/1.0" };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
  if (!res.ok) throw new GhlError(res.status, data, path);
  return data;
}

// ---------- schema lookups (cached per function instance) ----------
let fieldCache = null, pipeCache = null;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export async function fields() {
  if (fieldCache) return fieldCache;
  const d = await req("GET", `/locations/${loc()}/customFields`, { query: { model: "opportunity" } });
  fieldCache = Object.fromEntries((d.customFields || []).map((f) => [norm(f.name), f.id]));
  return fieldCache;
}
export async function fieldId(name) { return (await fields())[norm(name)]; }
export async function pipelines() {
  if (pipeCache) return pipeCache;
  pipeCache = (await req("GET", "/opportunities/pipelines", { query: { locationId: loc() } })).pipelines || [];
  return pipeCache;
}
/** Find pipeline by name; stage by first matching name in `stageNames`, else the pipeline's first stage. */
export async function stage(pipelineNames, stageNames) {
  const ps = await pipelines();
  const p = ps.find((x) => pipelineNames.some((n) => norm(x.name) === norm(n))) || ps.find((x) => pipelineNames.some((n) => norm(x.name).includes(norm(n))));
  if (!p) throw new Error(`GoHighLevel pipeline not found: ${pipelineNames[0]}`);
  let s = null;
  for (const n of stageNames) { s = p.stages.find((x) => norm(x.name) === norm(n)) || p.stages.find((x) => norm(x.name).includes(norm(n))); if (s) break; }
  s = s || p.stages[0];
  return { pipelineId: p.id, stageId: s.id, stageName: s.name, pipelineName: p.name };
}

// ---------- contacts ----------
export async function searchContacts(q) {
  const d = await req("POST", "/contacts/search", { body: { locationId: loc(), query: q, pageLimit: 20 } });
  return (d.contacts || []).map((c) => ({
    id: c.id, firstName: c.firstName || "", lastName: c.lastName || "", email: c.email || "", phone: c.phone || "",
    address: c.address1 || c.address || "", city: c.city || "", state: c.state || "", zip: c.postalCode || "",
  }));
}
export async function upsertContact(c) {
  const d = await req("POST", "/contacts/upsert", {
    body: {
      locationId: loc(), firstName: c.first, lastName: c.last, email: c.email || undefined, phone: c.phone || undefined,
      address1: c.address, city: c.city, state: c.state, postalCode: c.zip, source: "HomePro Field App",
    },
  });
  return (d.contact || d).id;
}
export const addNote = (contactId, body) => req("POST", `/contacts/${contactId}/notes`, { body: { body } });
export const addTags = (contactId, tags) => req("POST", `/contacts/${contactId}/tags`, { body: { tags } });

// ---------- opportunities ----------
export async function findOpenOpp(contactId, pipelineId) {
  const d = await req("GET", "/opportunities/search", { query: { location_id: loc(), contact_id: contactId, pipeline_id: pipelineId, status: "open", limit: 5 } });
  return (d.opportunities || [])[0] || null;
}
/** Build customFields array from { "Field Name": value }, skipping undefined values and unknown names. */
async function cf(byName) {
  const out = [], missing = [];
  for (const [name, v] of Object.entries(byName)) {
    if (v === undefined) continue;
    const id = await fieldId(name);
    if (!id) { missing.push(name); continue; }
    out.push({ id, v });
  }
  return { out, missing };
}
async function sendOpp(method, path, base, list) {
  try {
    return await req(method, path, { body: { ...base, customFields: list.map(({ id, v }) => ({ id, field_value: v })) } });
  } catch (e) {
    if (!(e instanceof GhlError) || ![400, 422].includes(e.status) || !list.length) throw e;
    return req(method, path, { body: { ...base, customFields: list.map(({ id, v }) => ({ id, fieldValue: v })) } });
  }
}
export async function createOpp({ contactId, pipelineId, stageId, name, value, fieldsByName = {} }) {
  const { out, missing } = await cf(fieldsByName);
  const d = await sendOpp("POST", "/opportunities/", { locationId: loc(), contactId, pipelineId, pipelineStageId: stageId, name, status: "open", monetaryValue: value }, out);
  return { id: (d.opportunity || d).id, missing };
}
export async function updateOpp(id, { pipelineId, stageId, value, status, name, fieldsByName = {} }) {
  const { out, missing } = await cf(fieldsByName);
  const base = {};
  if (pipelineId) base.pipelineId = pipelineId;
  if (stageId) base.pipelineStageId = stageId;
  if (value !== undefined) base.monetaryValue = value;
  if (status) base.status = status;
  if (name) base.name = name;
  await sendOpp("PUT", `/opportunities/${id}`, base, out);
  return { id, missing };
}
/** Upload a file into a FILE_UPLOAD opportunity field. Returns { url, attached }. */
export async function attachFile(oppId, fieldName, filename, bytes, mime) {
  const fid = await fieldId(fieldName);
  if (!fid) return { attached: false, error: `No "${fieldName}" field in GHL` };
  const uuid = randomUUID();
  const form = new FormData();
  form.set("id", oppId);
  form.set("maxFiles", "1");
  form.set(`${fid}_${uuid}`, new Blob([bytes], { type: mime }), filename);
  const up = await req("POST", `/locations/${loc()}/customFields/upload`, { form });
  const url = Object.values(up.uploadedFiles || {})[0] || up.meta?.[0]?.url || up.url;
  if (!url) return { attached: false, error: "Upload returned no URL" };
  const meta = { fieldname: `${fid}_${uuid}`, originalname: filename, encoding: "7bit", mimetype: mime, size: bytes.length, uuid };
  let lastErr;
  for (const value of [{ [uuid]: { meta, url, documentId: uuid } }, [{ url, meta }]]) {
    try { await sendOpp("PUT", `/opportunities/${oppId}`, {}, [{ id: fid, v: value }]); return { url, attached: true }; }
    catch (e) { lastErr = e; }
  }
  return { url, attached: false, error: String(lastErr?.message || lastErr) };
}
