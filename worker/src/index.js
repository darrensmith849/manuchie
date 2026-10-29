/* Manuchie website Worker.
   Static assets (dist/) are served by Cloudflare directly. wrangler.jsonc sends only
   /api/* and /admin/* here first ("run_worker_first"), so the dashboard is never
   reachable without a session. */

import { json, redirect, withHeaders, PRIVATE_HEADERS, DASHBOARD_CSP } from "./lib/http.js";
import { purge, maybePurge } from "./lib/store.js";
import { handleEnquiry } from "./enquiry.js";
import { handleCollect } from "./collect.js";
import { currentAdmin, requireAdmin, handleLogin, handleLogout } from "./auth.js";
import { handleAdminApi } from "./admin-api.js";

/* Dashboard files anyone may load: the login page and the stylesheet it shares. */
const ADMIN_PUBLIC = new Set(["/admin/login", "/admin/login.html", "/admin/login.js", "/admin/admin.css", "/admin/logo.svg"]);

const notAllowed = () => json({ ok: false, error: "method" }, 405, { Allow: "POST" });

async function serveAdmin(request, env, url) {
  const path = url.pathname;
  const admin = await currentAdmin(request, env);
  const isLogin = path === "/admin/login" || path === "/admin/login.html";
  if (isLogin && admin) return redirect("/admin/");
  if (!ADMIN_PUBLIC.has(path) && !admin) return redirect("/admin/login");
  const res = await env.ASSETS.fetch(request);
  return withHeaders(res, { ...PRIVATE_HEADERS, "Content-Security-Policy": DASHBOARD_CSP });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith("/api/")) ctx.waitUntil(maybePurge(env).catch((err) => console.error("housekeeping failed", err.message)));
    try {
      if (path === "/api/enquiry") return request.method === "POST" ? await handleEnquiry(request, env, ctx) : notAllowed();
      if (path === "/api/collect") return request.method === "POST" ? await handleCollect(request, env) : notAllowed();
      if (path === "/api/admin/login") return request.method === "POST" ? await handleLogin(request, env) : notAllowed();
      if (path === "/api/admin/logout") return request.method === "POST" ? await handleLogout(request, env) : notAllowed();
      if (path.startsWith("/api/admin/")) {
        const gate = await requireAdmin(request, env);
        if (gate.response) return gate.response;
        return await handleAdminApi(request, env, gate.admin, path.slice("/api/admin/".length));
      }
      if (path.startsWith("/api/")) return json({ ok: false, error: "not_found" }, 404);
      if (path === "/admin") return redirect("/admin/");
      if (path.startsWith("/admin/")) return await serveAdmin(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (err) {
      // Log the failure, never the request body (it may hold someone's message).
      console.error("worker error", request.method, path, err && err.stack ? err.stack : err);
      return json({ ok: false, error: "server" }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(purge(env));
  },
};
