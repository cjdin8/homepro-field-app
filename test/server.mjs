// Local harness with a fake GoHighLevel. Run:
// OMEGA_LOCAL=1 MAIL_TEST=1 SESSION_SECRET=dev APP_PIN=123456 GHL_TOKEN=x GHL_LOCATION_ID=LOC node test/server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

export const calls = [];
const realFetch = globalThis.fetch;
const FIELDS = ["Job Number", "Sale Date", "Install Date", "Products", "Number of Lifts", "Contract Price", "Deposit", "Balance Due", "Pay Terms", "Folding Rail", "Stop on Last Step", "Outlet Location", "Staircase Details", "Client Height and Weight", "Job Packet", "Packet Emailed", "Lead Notes"]
  .map((name, i) => ({ id: "f" + i, name }));
const PIPES = [
  { id: "sales", name: "Sales Pipeline", stages: [{ id: "s1", name: "New Lead" }, { id: "s2", name: "Contacted" }, { id: "s3", name: "Quoted – Following Up" }, { id: "s4", name: "Sold" }] },
  { id: "deal", name: "Deal Pipeline", stages: [{ id: "d1", name: "Sold – Packet Sent" }, { id: "d2", name: "Install Scheduled" }] },
];
export const opps = {};
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.hostname !== "services.leadconnectorhq.com") return realFetch(url, init);
  let body = init.body;
  if (body instanceof FormData) body = Object.fromEntries([...body.keys()].map((k) => [k, typeof body.get(k) === "string" ? body.get(k) : `<file ${body.get(k).size}b>`]));
  else if (typeof body === "string") body = JSON.parse(body);
  calls.push({ method: init.method || "GET", path: u.pathname, query: Object.fromEntries(u.searchParams), body });
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  const p = u.pathname;
  if (p.endsWith("/customFields") && (init.method || "GET") === "GET") return ok({ customFields: FIELDS });
  if (p === "/opportunities/pipelines") return ok({ pipelines: PIPES });
  if (p === "/contacts/search") return ok({ contacts: [{ id: "c9", firstName: "Dashannon", lastName: "Livingston", phone: "+14105640000", city: "Timmonsville", state: "SC", postalCode: "29161", address1: "3841 Panther Path" }] });
  if (p === "/contacts/upsert") return ok({ contact: { id: "c1" } });
  if (p === "/opportunities/search") return ok({ opportunities: Object.values(opps).filter((o) => o.contactId === u.searchParams.get("contact_id") && o.pipelineId === u.searchParams.get("pipeline_id") && o.status === "open") });
  if (p === "/opportunities/" && init.method === "POST") {
    if (body.customFields?.some((c) => "field_value" in c)) return new Response(JSON.stringify({ message: "field_value should not exist" }), { status: 422 });
    const id = "o" + (Object.keys(opps).length + 1); opps[id] = { id, ...body }; return ok({ opportunity: opps[id] });
  }
  let m;
  if ((m = p.match(/^\/opportunities\/(\w+)$/)) && init.method === "PUT") {
    if (body.customFields?.some((c) => "field_value" in c)) return new Response(JSON.stringify({ message: "field_value should not exist" }), { status: 422 });
    const o = opps[m[1]] || (opps[m[1]] = { id: m[1], customFields: [] });
    const { customFields = [], ...rest } = body; Object.assign(o, rest);
    for (const c of customFields) { const ex = (o.customFields ||= []).find((x) => x.id === c.id); if (ex) ex.fieldValue = c.fieldValue; else o.customFields.push(c); }
    return ok({ opportunity: o });
  }
  if (p.endsWith("/customFields/upload")) return ok({ uploadedFiles: { "x.pdf": "https://storage.example/x.pdf" } });
  if (/\/contacts\/\w+\/(notes|tags)$/.test(p)) return ok({});
  return new Response("not mocked " + p, { status: 404 });
};

const { default: handler } = await import("../netlify/functions/api.mjs");
const root = path.resolve("public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handler(new Request(`http://localhost:${server.address().port}${req.url}`, { method: req.method, headers: req.headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
  if (!f.startsWith(root) || !fs.existsSync(f)) f = path.join(root, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
});
if (process.argv[1].endsWith("server.mjs")) server.listen(8899, () => console.log("http://localhost:8899"));
