import { loadConfig } from "./config.js";
import { logger } from "./utils/logger.js";
import { browserLogin } from "./auth/browser-login.js";
import { selectEvent } from "./events/event-selector.js";
import { ApiClient } from "./http/client.js";
import { pollForSeats } from "./polling/seat-poller.js";
import { buildPriceCategoriesInRange } from "./polling/seat-filter.js";
import { selectBestSeat } from "./selection/seat-selector.js";
import { verifyBasket } from "./selection/basket.js";
import { sendTelegramAlert } from "./notifications/telegram.js";
import { handoffToCheckout } from "./checkout/checkout-handoff.js";
import type { PriceCategoryMap } from "./types/api.js";

async function main(): Promise<void> {
  logger.info("Arsenal Ticket Bot starting...");

  // 1. Load and validate config
  const config = loadConfig();
  logger.info("Configuration loaded");

  // 2. Browser login
  const { cookies, cookieString, userAgent, browser, context, page } =
    await browserLogin(config.EMAIL, config.PASSWORD);

  // AbortController for clean shutdown
  const ac = new AbortController();
  const shutdown = () => {
    logger.info("Shutting down...");
    ac.abort();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Create HTTP client early so it's ready before page navigation completes
  const client = new ApiClient({
    cookieString,
    userAgent,
    signal: ac.signal,
  });

  try {
    // 3. Select event
    const event = await selectEvent(page);

    // 4. Navigate to event page and verify login + load event config in parallel
    //    page.goto() and the HTTP calls are independent, so overlap them
    const eventPageUrl = `https://www.eticketing.co.uk/arsenal/EDP/Event/Index/${event.id}`;
    const httpConfigPromise = Promise.all([
      client.verifyLogin(),
      client.getEventConfig(event.id),
    ]);
    await page.goto(eventPageUrl, { waitUntil: "load" });
    logger.info({ url: eventPageUrl }, "Navigated to event page");

    // 5. Await the HTTP results (likely already resolved while page was loading)
    const [loggedIn, eventConfig] = await httpConfigPromise;

    if (!loggedIn) {
      throw new Error("HTTP session verification failed - cookies may be invalid");
    }
    logger.info("HTTP session verified");

    const allPrices = eventConfig.Prices?.Prices ?? [];

    // Filter to Adult prices only, build PriceCategory → PriceType map
    const priceCategoryMap: PriceCategoryMap = new Map();
    const adultPrices = new Map<string, number>();

    for (const p of allPrices) {
      if (p.PriceTypeDescription === "Adult") {
        priceCategoryMap.set(p.PriceCategory, p.PriceType);
        adultPrices.set(p.PriceCategory, p.TotalFaceValue);
      }
    }

    logger.info(
      {
        totalPriceEntries: allPrices.length,
        adultCategories: priceCategoryMap.size,
        prices: [...adultPrices.entries()].map(
          ([cat, pence]) => `${cat}: £${(pence / 100).toFixed(2)}`,
        ),
      },
      "Event config loaded",
    );

    // Build the set of price categories that fall in the user's price range
    const priceCategoriesInRange = buildPriceCategoriesInRange(
      priceCategoryMap,
      adultPrices,
      config.MIN_PRICE,
      config.MAX_PRICE,
    );

    if (priceCategoriesInRange.size === 0) {
      logger.warn(
        { minPrice: config.MIN_PRICE, maxPrice: config.MAX_PRICE },
        "No adult price categories in the specified range! Will still check resale prices.",
      );
    }

    // Cache query strings before entering the hot polling loop
    const queryParams = {
      eventId: event.id,
      quantity: config.QUANTITY,
      together: config.TOGETHER,
      minPrice: config.MIN_PRICE,
      maxPrice: config.MAX_PRICE,
    };
    client.cacheQueryStrings(queryParams);

    // 6. Poll for seats
    const eventIdNum = parseInt(event.id, 10);
    logger.info(
      {
        minPrice: config.MIN_PRICE,
        maxPrice: config.MAX_PRICE,
        quantity: config.QUANTITY,
        together: config.TOGETHER,
        categoriesInRange: [...priceCategoriesInRange],
        pollInterval: `${config.POLL_MIN_INTERVAL_MS}-${config.POLL_MAX_INTERVAL_MS}ms`,
      },
      "Starting seat polling...",
    );

    const pollResult = await pollForSeats(client, {
      queryParams,
      filterOpts: {
        minPrice: config.MIN_PRICE,
        maxPrice: config.MAX_PRICE,
        preferredBlocks: config.PREFERRED_BLOCKS,
        priceCategoriesInRange,
      },
      minIntervalMs: config.POLL_MIN_INTERVAL_MS,
      maxIntervalMs: config.POLL_MAX_INTERVAL_MS,
      initialIntervalMs: config.POLL_INITIAL_INTERVAL_MS,
      signal: ac.signal,
    });

    // 7. Select the best seat
    const selection = await selectBestSeat(
      client,
      pollResult.seats,
      eventIdNum,
      priceCategoryMap,
    );
    if (!selection) {
      logger.error("Failed to select any seat - all attempts rejected. Restarting poll...");
      // Could loop here, but for now just exit
      return;
    }

    // 8. Verify basket
    const basketCount = await verifyBasket(client);
    if (basketCount === 0) {
      logger.error("Basket is empty after seat selection!");
      return;
    }

    // Fire-and-forget: start basket timer and send Telegram alert (don't block checkout)
    client.startBasketTimer().then(
      () => logger.info("Basket timer started"),
      () => logger.warn("Failed to start basket timer (non-fatal)"),
    );

    sendTelegramAlert(
      config.TELEGRAM_BOT_TOKEN,
      config.TELEGRAM_CHAT_ID,
      selection,
      event.name,
    );

    // 9. Handoff to browser for checkout
    await handoffToCheckout(
      context,
      page,
      client.getCookieString(),
      cookies,
    );

    logger.info("Checkout page is open - complete your purchase!");
    logger.info("Press Ctrl+C when done to close the browser.");

    // Keep the process alive so the browser stays open
    await new Promise<void>((resolve) => {
      ac.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  } catch (err) {
    if (ac.signal.aborted) {
      logger.info("Bot stopped by user");
    } else {
      logger.error({ error: (err as Error).message }, "Fatal error");
    }
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await client.close();
    await browser.close();
    logger.info("Browser closed. Goodbye!");
  }
}

main().catch((err) => {
  logger.fatal({ error: err.message }, "Unhandled error");
  process.exit(1);
});
