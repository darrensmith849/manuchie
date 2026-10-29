/* Small Web Crypto helpers. Work the same in the Worker and in Node (tests, scripts). */

const enc = new TextEncoder();

export const toHex = (buf) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export const toB64Url = (buf) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromB64Url = (str) => {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export const randomToken = (n = 32) => toB64Url(randomBytes(n));
export const newId = () => crypto.randomUUID();

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export async function hmacHex(key, text) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
}

/* Constant-time comparison of two strings of equal length. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Passwords: PBKDF2-SHA256. Workers cap PBKDF2 at 100,000 iterations.
   Stored as  pbkdf2_sha256$<iterations>$<salt b64url>$<hash b64url>  */
export const PBKDF2_ITERATIONS = 100000;

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = randomBytes(16);
  const bits = await pbkdf2(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${toB64Url(salt)}$${toB64Url(bits)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored || "").split("$");
  const iterations = Number(iter);
  if (scheme !== "pbkdf2_sha256" || !salt || !hash || !(iterations > 0 && iterations <= PBKDF2_ITERATIONS)) return false;
  const bits = await pbkdf2(password, fromB64Url(salt), iterations);
  return safeEqual(toB64Url(bits), hash);
}

/* A password hash to verify against when the email is unknown, so a failed login
   takes the same time whether or not the account exists. */
let dummyHash;
export async function dummyVerify(password) {
  dummyHash = dummyHash || (await hashPassword("not-a-real-password"));
  await verifyPassword(password, dummyHash);
  return false;
}
