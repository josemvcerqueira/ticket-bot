import type { BrowserCookie } from "../types/api.js";

/**
 * Convert an array of browser cookies into a single Cookie header string.
 */
export function cookiesToString(cookies: BrowserCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Parse a Cookie header string back into an array of partial BrowserCookie objects.
 * Used when syncing cookies back to the browser.
 */
export function stringToCookies(
  cookieString: string,
  domain: string,
): BrowserCookie[] {
  return cookieString
    .split("; ")
    .filter(Boolean)
    .map((pair) => {
      const eqIdx = pair.indexOf("=");
      const name = pair.slice(0, eqIdx);
      const value = pair.slice(eqIdx + 1);
      return {
        name,
        value,
        domain,
        path: "/",
        httpOnly: false,
        secure: true,
      };
    });
}

/**
 * Merge updated cookie values into the existing cookie array.
 * New cookies are added, existing ones are updated by name.
 */
export function mergeCookies(
  existing: BrowserCookie[],
  updates: BrowserCookie[],
): BrowserCookie[] {
  const map = new Map(existing.map((c) => [c.name, c]));
  for (const cookie of updates) {
    map.set(cookie.name, cookie);
  }
  return [...map.values()];
}
