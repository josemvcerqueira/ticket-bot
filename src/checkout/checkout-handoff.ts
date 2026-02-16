import type { BrowserContext, Page } from "playwright";
import { logger } from "../utils/logger.js";
import { stringToCookies, mergeCookies } from "../auth/session.js";
import type { BrowserCookie } from "../types/api.js";

const BASKET_URL = "https://www.eticketing.co.uk/arsenal/Checkout/Basket";

/**
 * Sync cookies from the HTTP client back into the Playwright browser context,
 * then navigate to the checkout/basket page so the user can complete the purchase.
 */
export async function handoffToCheckout(
  context: BrowserContext,
  page: Page,
  httpCookieString: string,
  originalCookies: BrowserCookie[],
): Promise<void> {
  logger.info("Syncing cookies back to browser for checkout...");

  // Merge HTTP cookies back into original browser cookies
  const httpCookies = stringToCookies(httpCookieString, ".eticketing.co.uk");
  const merged = mergeCookies(originalCookies, httpCookies);

  // Set cookies in the browser context
  await context.addCookies(
    merged.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: (c.sameSite as "Strict" | "Lax" | "None") ?? "Lax",
    })),
  );

  logger.info("Navigating to checkout...");
  await page.goto(BASKET_URL, { waitUntil: "domcontentloaded" });

  logger.info("Checkout page opened - complete purchase in the browser!");
}
