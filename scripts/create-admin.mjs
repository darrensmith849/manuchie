#!/usr/bin/env node
/* Create (or reset the password of) a dashboard administrator.
   The password is typed here, hashed here (PBKDF2-SHA256, same format as the Worker), and
   only the hash is written to D1. Nothing is stored in the repository.

   Usage:
     node scripts/create-admin.mjs --email you@example.com            # production (remote D1)
     node scripts/create-admin.mjs --email you@example.com --local    # wrangler dev database
   Options:
     --reset      replace the password of an existing admin (signs out their sessions)
     --persist-to <dir> local database folder, if wrangler dev was started with one
     --password-stdin   read the password from stdin (for automated tests only)        */

import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { hashPassword } from "../worker/src/lib/crypto.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const email = String(value("--email") || "").trim().toLowerCase();
const local = flag("--local");
const reset = flag("--reset");
const MIN = 12;

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: node scripts/create-admin.mjs --email you@example.com [--local] [--reset]");
  process.exit(1);
}

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(prompt); }; // hide typed characters
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function readPassword() {
  if (flag("--password-stdin")) {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data.replace(/\r?\n$/, "");
  }
  if (!process.stdin.isTTY) {
    console.error("Run this in a terminal so the password can be typed without being shown.");
    process.exit(1);
  }
  const first = await ask(`New password for ${email} (at least ${MIN} characters): `);
  const second = await ask("Type it again: ");
  if (first !== second) { console.error("The passwords didn't match. Nothing was changed."); process.exit(1); }
  return first;
}

const password = await readPassword();
if (password.length < MIN || password.length > 200) {
  console.error(`Use between ${MIN} and 200 characters. Nothing was changed.`);
  process.exit(1);
}

const hash = await hashPassword(password);
const now = new Date().toISOString();
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sql = reset
  ? `UPDATE admins SET password_hash = ${q(hash)}, updated_at = ${q(now)} WHERE email = ${q(email)};
     DELETE FROM sessions WHERE admin_id IN (SELECT id FROM admins WHERE email = ${q(email)});`
  : `INSERT INTO admins (id, email, password_hash, created_at, updated_at)
     VALUES (${q(crypto.randomUUID())}, ${q(email)}, ${q(hash)}, ${q(now)}, ${q(now)});`;

// Pass the SQL through a private temp file so the hash never appears in shell history.
const dir = mkdtempSync(join(tmpdir(), "manuchie-admin-"));
const file = join(dir, "admin.sql");
writeFileSync(file, sql, { mode: 0o600 });
const target = local ? ["--local", ...(value("--persist-to") ? ["--persist-to", value("--persist-to")] : [])] : ["--remote"];
const result = spawnSync("npx", ["--yes", "wrangler@4.155.0", "d1", "execute", "manuchie", ...target, "--file", file, "--yes"],
  { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
rmSync(dir, { recursive: true, force: true });

if (result.status !== 0) {
  const out = (result.stderr || "") + (result.stdout || "");
  if (/UNIQUE constraint failed: admins.email/.test(out)) console.error(`${email} is already an admin. Use --reset to change the password.`);
  else console.error("Wrangler couldn't write to the database:\n" + out.replace(/pbkdf2_sha256\$[^'"\s]+/g, "[hash]"));
  process.exit(1);
}
if (reset && /"changes":\s*0\b/.test(result.stdout)) {
  console.error(`No admin with the email ${email} exists. Run without --reset to create one.`);
  process.exit(1);
}
console.log(`${reset ? "Password updated" : "Admin created"} for ${email} (${local ? "local" : "production"} database).`);
console.log(`Sign in at ${local ? "http://localhost:8787" : "https://manuchie.org"}/admin/login`);
