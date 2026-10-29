// Only a server-issued opaque OAuth request can change the login destination.
// Arbitrary callback URLs are never accepted as post-login redirects.
const KEY = "sellcase.oauth.request";
const VALID = /^[A-Za-z0-9_-]{43}$/;
export function rememberOAuthRequest() {
  const request = new URLSearchParams(window.location.search).get("oauth_request");
  try {
    if (request && VALID.test(request)) {
      sessionStorage.setItem(KEY, JSON.stringify({ request, expiresAt: Date.now() + 600_000 }));
    } else {
      // A normal login must not inherit an abandoned authorization flow.
      sessionStorage.removeItem(KEY);
    }
  } catch { /* Browser storage restrictions must not break existing login. */ }
}
export function postLoginDestination() {
  try {
    const saved = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const pending = saved ? JSON.parse(saved) : null;
    if (pending && typeof pending.request === "string" && VALID.test(pending.request) && pending.expiresAt > Date.now()) {
      return `/oauth/consent?request=${encodeURIComponent(pending.request)}`;
    }
  } catch { /* Preserve the original destination if storage is unavailable. */ }
  return "/admin/dashboard";
}
