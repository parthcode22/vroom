/**
 * New V Auth sign-ins can be paused without touching existing sessions. Anyone
 * already signed in keeps their session and their socket; only the door for new
 * sign-ins closes. Anything other than "off" leaves it open, so a missing or
 * mistyped value never locks the whole college out.
 */
export function isVAuthSignInOpen(
  value: string | undefined = process.env.VAUTH_SIGN_IN,
): boolean {
  return value?.trim().toLowerCase() !== "off";
}

/**
 * better-auth paths that start a new sign-in or complete one. Session reads and
 * sign-out are deliberately absent: they must keep working while paused.
 */
const SIGN_IN_PATHS = ["/api/auth/sign-in/", "/api/auth/oauth2/"];

export function isSignInRequest(request: Request): boolean {
  try {
    const { pathname } = new URL(request.url);
    return SIGN_IN_PATHS.some((prefix) => pathname.startsWith(prefix));
  } catch {
    return false;
  }
}
