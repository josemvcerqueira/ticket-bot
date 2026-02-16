import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { logger } from "../utils/logger.js";
import type { BrowserCookie } from "../types/api.js";
import { cookiesToString } from "./session.js";

const BASE_URL = "https://www.eticketing.co.uk";
const LOGIN_URL = `${BASE_URL}/arsenal/Authentication/Login`;

export interface LoginResult {
  cookies: BrowserCookie[];
  cookieString: string;
  userAgent: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Launch a stealth Playwright browser, log in to eticketing.co.uk,
 * and extract all cookies for use with the HTTP client.
 */
export async function browserLogin(
  email: string,
  password: string,
): Promise<LoginResult> {
  logger.info("Launching browser for login...");

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "en-GB",
    timezoneId: "Europe/London",
  });

  // Remove webdriver flag via addInitScript (no extra page/CDP needed)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    (window as any).chrome = { runtime: {} };
  });

  const page = await context.newPage();

  logger.info("Navigating to login page...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  // Dismiss cookie consent if present
  try {
    const consentBtn = page.locator("#onetrust-accept-btn-handler");
    await consentBtn.waitFor({ state: "visible", timeout: 5000 });
    await consentBtn.click();
    logger.info("Dismissed cookie consent banner");
  } catch {
    // No consent banner, that's fine
  }

  // Fill login form with human-like typing delays (reduced but still realistic)
  logger.info("Filling login credentials...");
  const emailInput = page.locator('input[name="EmailAddress"], input[type="email"], #EmailAddress');
  await emailInput.waitFor({ state: "visible", timeout: 10_000 });
  await emailInput.click();
  await emailInput.pressSequentially(email, {
    delay: 30 + Math.random() * 40,
  });

  await page.waitForTimeout(200 + Math.random() * 200);

  const passwordInput = page.locator('input[name="Password"], input[type="password"], #Password');
  await passwordInput.click();
  await passwordInput.pressSequentially(password, {
    delay: 30 + Math.random() * 40,
  });

  await page.waitForTimeout(200 + Math.random() * 200);

  // Click submit
  const submitBtn = page.locator(
    'button[type="submit"], input[type="submit"], .login-btn, #login-btn',
  );
  await submitBtn.click();

  // Wait for navigation after login
  logger.info("Waiting for login to complete...");
  await page.waitForURL((url) => !url.href.includes("Authentication/Login"), {
    timeout: 30_000,
  });

  logger.info("Login successful, extracting cookies...");

  // Extract cookies via CDP for all domains
  const cdpSession = await context.newCDPSession(page);
  const { cookies: cdpCookies } = await cdpSession.send("Network.getAllCookies");

  const cookies: BrowserCookie[] = cdpCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
    expires: c.expires,
  }));

  const userAgent = await page.evaluate(() => navigator.userAgent);
  const cookieString = cookiesToString(
    cookies.filter(
      (c) =>
        c.domain.includes("eticketing.co.uk") ||
        c.domain.includes(".eticketing.co.uk"),
    ),
  );

  logger.info(
    { cookieCount: cookies.length },
    "Cookies extracted successfully",
  );

  return { cookies, cookieString, userAgent, browser, context, page };
}
