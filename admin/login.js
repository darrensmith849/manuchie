/* Dashboard sign-in. The session cookie is HttpOnly; this page never sees it. */
(function () {
  "use strict";
  const form = document.getElementById("loginForm");
  const error = document.getElementById("loginError");
  const button = document.getElementById("loginBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    if (!email || !password) {
      error.textContent = "Enter your email and password.";
      (email ? form.elements.password : form.elements.email).focus();
      return;
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Signing in…";
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "same-origin",
      });
      if (res.ok) { window.location.replace("/admin/"); return; }
      error.textContent = res.status === 429
        ? "Too many attempts. Wait 15 minutes, then try again."
        : "That email and password don't match. Try again.";
      form.elements.password.value = "";
      form.elements.password.focus();
    } catch {
      error.textContent = "Couldn't reach the server. Check your connection and try again.";
    }
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = "Sign in";
  });
})();
