/**
 * Same-origin enforcement for state-changing requests.
 *
 * better-auth's default `sameSite: "lax"` session cookie would stop a cross-site
 * form post today, but nothing in this repo sets that value, asserts it, or
 * tests it — it is a dependency default that a later config change could remove
 * silently. The console action closes the room and suspends handles, so the
 * check is explicit here rather than inherited.
 */

function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

/**
 * For endpoints that authenticate with the session cookie. `same-site` is
 * refused along with `cross-site`: V Rooms is one Worker on one origin, so a
 * sibling subdomain has no business posting here either.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";

  const origin = request.headers.get("origin");
  if (origin) return origin === requestOrigin(request);

  // A browser that would have sent one of those headers on a cross-site post
  // sent neither, so this is not a request the cookie can be trusted on.
  return false;
}

/**
 * For the script front door, which authenticates with a bearer token a
 * cross-site page cannot set without a preflight. A non-browser caller sends
 * neither header and is allowed; a browser that announces itself as cross-origin
 * is not.
 */
export function isBrowserCrossOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;

  const origin = request.headers.get("origin");
  return origin !== null && origin !== requestOrigin(request);
}
