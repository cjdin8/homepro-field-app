// Single-user PIN login (CJ). PIN lives in the APP_PIN environment variable.
import { createHmac, timingSafeEqual } from "node:crypto";

const env = (k) => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);
const secret = () => { const s = env("SESSION_SECRET"); if (!s) throw new Error("SESSION_SECRET is not set in Netlify"); return s; };
export const sign = (s) => createHmac("sha256", secret()).update(s).digest("base64url");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function checkPin(pin) {
  const want = env("APP_PIN");
  if (!want) throw new Error("APP_PIN is not set in Netlify");
  return same(pin, want);
}
export function issueToken() {
  const body = Buffer.from(JSON.stringify({ u: "cj", exp: Date.now() + 30 * 864e5 })).toString("base64url");
  return `${body}.${sign(body)}`;
}
export function validToken(token) {
  if (!token || !token.includes(".")) return false;
  const [body, sig] = token.split(".");
  if (!same(sig, sign(body))) return false;
  try { return JSON.parse(Buffer.from(body, "base64url").toString()).exp > Date.now(); } catch { return false; }
}
