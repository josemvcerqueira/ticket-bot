import { select } from "@inquirer/prompts";
import type { Page } from "playwright";
import { logger } from "../utils/logger.js";
import type { EventListItem } from "../types/api.js";

const EVENTS_URL = "https://www.eticketing.co.uk/arsenal/Events";

/**
 * Navigate to the events page, scrape the event list, and present
 * an interactive CLI picker for the user to choose an event.
 */
export async function selectEvent(page: Page): Promise<EventListItem> {
  logger.info("Loading events page...");
  await page.goto(EVENTS_URL, { waitUntil: "domcontentloaded" });

  // Single evaluate: try primary selectors, fall back to all anchors, de-duplicate inline
  const events = await page.evaluate(() => {
    const seen = new Map<string, { id: string; name: string; date: string; url: string }>();

    // Primary selectors for event listings
    const eventLinks = document.querySelectorAll(
      'a[href*="/arsenal/EDP/"], .event-item a, .event-list a, .events-list a',
    );

    for (const link of eventLinks) {
      const anchor = link as HTMLAnchorElement;
      const href = anchor.href || "";
      const name =
        anchor.querySelector(".event-name, .title, h3, h4")?.textContent?.trim() ||
        anchor.textContent?.trim() ||
        "";

      const idMatch = href.match(/\/EDP\/(?:Event\/)?(\d+)/);
      if (idMatch && name && !seen.has(idMatch[1])) {
        seen.set(idMatch[1], { id: idMatch[1], name, date: anchor.querySelector(".event-date, .date, time")?.textContent?.trim() || "", url: href });
      }
    }

    // Fallback: scan all anchors if primary found nothing
    if (seen.size === 0) {
      for (const a of document.querySelectorAll("a")) {
        const href = a.href;
        const match = href.match(/\/arsenal\/EDP\/(\d+)/);
        if (match && !seen.has(match[1])) {
          seen.set(match[1], {
            id: match[1],
            name: a.textContent?.trim() || `Event ${match[1]}`,
            date: "",
            url: href,
          });
        }
      }
    }

    return [...seen.values()];
  });

  if (events.length === 0) {
    throw new Error(
      "No events found on the page. The page structure may have changed.",
    );
  }

  logger.info({ count: events.length }, "Events found");

  const chosen = await select({
    message: "Select an event:",
    choices: events.map((e) => ({
      name: e.date ? `${e.name} (${e.date})` : e.name,
      value: e,
    })),
  });

  logger.info({ eventId: chosen.id, eventName: chosen.name }, "Event selected");
  return chosen;
}
