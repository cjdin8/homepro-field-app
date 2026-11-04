// Netlify Blobs on Netlify; an in-memory stand-in for local testing.
import { getStore as netlifyStore } from "@netlify/blobs";

const mem = new Map();
function memStore(name) {
  if (!mem.has(name)) mem.set(name, new Map());
  const m = mem.get(name);
  return {
    async set(k, v, o = {}) { m.set(k, { data: v, metadata: o.metadata || {} }); return { modified: true }; },
    async setJSON(k, v) { m.set(k, { data: JSON.stringify(v), metadata: {} }); return { modified: true }; },
    async get(k, o = {}) { const e = m.get(k); if (!e) return null; return o.type === "json" ? JSON.parse(e.data) : e.data; },
    async getWithMetadata(k) { const e = m.get(k); return e ? { data: e.data, metadata: e.metadata } : null; },
    async list() { return { blobs: [...m.keys()].map((key) => ({ key })) }; },
  };
}

export function getStore(opts) {
  const name = typeof opts === "string" ? opts : opts.name;
  if (process.env.OMEGA_LOCAL === "1") return memStore(name);
  return netlifyStore(opts);
}
