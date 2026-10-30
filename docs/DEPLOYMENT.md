# Setup and deployment

Everything runs on Cloudflare in **Manuchie01@gmail.com's Account**
(`c47856fcc04d89b572273dafaae646f1`): one Worker named `manuchie` that serves the website
from `dist/`, the enquiry API, the analytics beacon and the private dashboard, plus a D1
database named `manuchie` (`ce4b8ead-c827-4919-bc07-eb12eeb470e9`, already created).
Configuration lives in [`wrangler.jsonc`](../wrangler.jsonc).

## Current state (29 Oct 2026)

Live on manuchie.org: the redesigned page, the enquiry API, first-party analytics and the
dashboard. The database tables exist and the first admin (`manuchie01@gmail.com`) is created.
Still to do: email delivery (§2) and, optionally, the daily cron (see the end of this file).

## What you need

- Node.js 20 or newer, and `npm install` once in this folder (installs Wrangler 4.155.0).
- Wrangler signed in to Manuchie's account: `npx wrangler login`, then check with
  `npx wrangler whoami` (it must list *Manuchie01@gmail.com's Account*).
  Wrangler keeps one login per computer, so signing in here replaces a login to another
  Cloudflare account. To keep both, give this account its own profile, e.g.
  `HOME=~/.cf-manuchie npm_config_cache=~/.npm npx wrangler login` and the same prefix on every
  later `npx wrangler …` / `node scripts/create-admin.mjs …` command.
- For email: a [Resend](https://resend.com) account (free tier: 3,000 emails a month).

## 1. Create or upgrade the database tables

```bash
HOME=~/.cf-manuchie npm_config_cache=~/.npm npx wrangler d1 migrations apply manuchie --remote
```

Run it again whenever `migrations/` gains a file (0002 added projects, to-dos, money and
client phone/company). It only applies migrations that haven't run yet.

## 2. Set up email delivery (Resend)

1. Sign up at resend.com with Manuchie's address and open **Domains → Add domain** →
   `manuchie.org`.
2. Resend shows DNS records (an MX and TXT record for `send.manuchie.org`, and a DKIM
   TXT record). Add each one in Cloudflare: **manuchie.org → DNS → Records → Add record**,
   type and values exactly as Resend shows them, proxy status **DNS only**. Then press
   **Verify** in Resend; it usually turns green within minutes.
3. In Resend, **API Keys → Create API key**, permission **Sending access**, domain
   `manuchie.org`. Copy the key (it is shown once).
4. Store the three secrets on the Worker. Each command asks for the value, so nothing
   ends up in your shell history or the repository:

   ```bash
   npx wrangler secret put MAIL_TO          # Manuchie's inbox, e.g. manuchie01@gmail.com
   npx wrangler secret put MAIL_FROM        # Manuchie Website <enquiries@manuchie.org>
   npx wrangler secret put RESEND_API_KEY   # the key from step 3
   ```

5. Optional: to send each visitor a short "thanks, it arrived" email (it never repeats
   their message), set `"SEND_ACKNOWLEDGEMENT": "true"` under `vars` in `wrangler.jsonc`
   and deploy.

Until these are set, the form still works: every enquiry is saved to the dashboard, and
its "Email to you" line says email isn't set up. **Settings** in the dashboard shows the
current state.

## 3. Deploy

```bash
./build.sh && HOME=~/.cf-manuchie npm_config_cache=~/.npm npx wrangler deploy
```

`HOME=~/.cf-manuchie` keeps the sign-in to Manuchie's Cloudflare account separate from any other
Wrangler login on this Mac. If it says you're not signed in, run the same prefix with `login`
first (the Cloudflare "Allow" page waits about two minutes).

`build.sh` builds the public site and copies the dashboard into `dist/`. The deploy keeps
both custom domains (`manuchie.org`, `www.manuchie.org`) attached.

## 4. Create the first dashboard administrator

There is no sign-up page. Create the admin from this folder; the password is typed
(hidden) in your terminal, hashed on your computer, and only the hash is stored:

```bash
node scripts/create-admin.mjs --email manuchie01@gmail.com
```

Then sign in at **https://manuchie.org/admin/login**. Use at least 12 characters; a
password manager is best.

- Forgotten password: `node scripts/create-admin.mjs --email … --reset` (signs out every
  session for that admin).
- Change it while signed in: **Settings → Change password**.
- A second admin: run the script again with another email.

## Local development

```bash
cp .dev.vars.example .dev.vars          # local secrets, git-ignored
npx wrangler d1 migrations apply manuchie --local
node scripts/create-admin.mjs --email you@example.com --local
./build.sh && npx wrangler dev --infer-origin-from-routes=false
```

Open http://localhost:8787 (site) and http://localhost:8787/admin/login (dashboard).
To try email without sending real mail, point `RESEND_API_URL` in `.dev.vars` at a mock.

## Tests

```bash
npm test                                   # unit tests (no network)
./build.sh && node worker/test/integration.mjs   # 73 backend checks on a throwaway local database
```

`worker/test/site-e2e.mjs` (31 browser checks: the real page against the real Worker, through to
the dashboard) and `worker/test/dashboard-qa.mjs` (dashboard screenshots at 390/768/1024/1440 px
plus axe-core) need Playwright and axe-core installed outside the repo (see the file headers).
Results: `docs/TEST_REPORT.md`.

## Environment variables

| name | where | purpose |
|---|---|---|
| `MAIL_TO` | secret | inbox that receives enquiries |
| `MAIL_FROM` | secret | verified Resend sender |
| `RESEND_API_KEY` | secret | Resend API key (sending access) |
| `SEND_ACKNOWLEDGEMENT` | var in `wrangler.jsonc` | `"true"` sends the visitor a confirmation |
| `RESEND_API_URL` | `.dev.vars` only | testing: send to a mock instead of Resend |

The session pepper and the daily analytics salts are generated automatically and kept in
the database (`settings` table); there is nothing to configure for them.

## Housekeeping and the optional cron

Expired sessions, rate-limit rows, analytics salts older than two days and events older than
13 months are removed automatically, alongside normal API traffic, at most every 6 hours. A
daily cron is optional: Cloudflare only accepts cron triggers once the account has a
`workers.dev` subdomain. Open **Workers & Pages** once in Manuchie's dashboard (that creates
it), then uncomment the `triggers` line in `wrangler.jsonc` and deploy.

## Rolling back

```bash
npx wrangler deployments list
npx wrangler rollback <version-id>
```

The static site before this rebuild is also tagged in git: `backup/pre-rebuild-2026-10-29`.
