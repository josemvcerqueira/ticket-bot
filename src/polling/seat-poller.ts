import { logger } from "../utils/logger.js";
import type { ApiClient, SeatQueryParams } from "../http/client.js";
import type { AreaAvailability, CategorizedSeat } from "../types/api.js";
import { AdaptiveInterval } from "./adaptive-interval.js";
import { flattenSeats, isBlockResponse, type SeatFilterOptions } from "./seat-filter.js";

export interface PollerOptions {
  queryParams: SeatQueryParams;
  filterOpts: SeatFilterOptions;
  minIntervalMs: number;
  maxIntervalMs: number;
  initialIntervalMs: number;
  signal: AbortSignal;
}

export interface PollResult {
  seats: CategorizedSeat[];
}

/**
 * Main polling loop. Concurrently checks regular and resale endpoints,
 * filters results, and returns the first matching seats found.
 */
export async function pollForSeats(
  client: ApiClient,
  opts: PollerOptions,
): Promise<PollResult> {
  const { queryParams, filterOpts, minIntervalMs, maxIntervalMs, initialIntervalMs, signal } = opts;

  const interval = new AdaptiveInterval(minIntervalMs, maxIntervalMs, initialIntervalMs);
  let pollCount = 0;

  while (!signal.aborted) {
    pollCount++;
    logger.info({ poll: pollCount, interval: interval.get() }, "Polling for seats...");

    try {
      // Concurrent polling of both regular and resale
      const [regularResult, resaleResult] = await Promise.allSettled([
        client.getAvailableRegular(queryParams, { signal }),
        client.getAvailableResale(queryParams, { signal }),
      ]);

      const allSeats: CategorizedSeat[] = [];
      let wasBlocked = false;

      // Process regular results
      if (regularResult.status === "fulfilled") {
        const resp = regularResult.value;
        if (isBlockResponse(resp)) {
          wasBlocked = true;
          logger.warn("Regular endpoint returned block response (rate limited)");
        } else {
          const areas = resp as AreaAvailability[];
          const filtered = flattenSeats(areas, "regular", filterOpts);
          for (const seat of filtered) {
            allSeats.push({ seat, source: "regular" });
          }
          logger.debug({ total: areas.length, filtered: filtered.length }, "Regular seats");
        }
      } else {
        logger.warn({ error: regularResult.reason?.message }, "Regular poll failed");
      }

      // Process resale results
      if (resaleResult.status === "fulfilled") {
        const resp = resaleResult.value;
        if (isBlockResponse(resp)) {
          wasBlocked = true;
          logger.warn("Resale endpoint returned block response (rate limited)");
        } else {
          const areas = resp as AreaAvailability[];
          const filtered = flattenSeats(areas, "resale", filterOpts);
          for (const seat of filtered) {
            allSeats.push({ seat, source: "resale" });
          }
          logger.debug({ total: areas.length, filtered: filtered.length }, "Resale seats");
        }
      } else {
        logger.warn({ error: resaleResult.reason?.message }, "Resale poll failed");
      }

      // Found seats!
      if (allSeats.length > 0) {
        interval.onActivity();
        logger.info(
          {
            count: allSeats.length,
            first: `Area ${allSeats[0].seat.areaId} Y${allSeats[0].seat.yCoord} X${allSeats[0].seat.xCoord} £${allSeats[0].seat.price} (${allSeats[0].source})`,
          },
          "Seats found!",
        );
        return { seats: allSeats };
      }

      // Adjust interval
      if (wasBlocked) {
        interval.onRateLimit();
        logger.warn("Rate limited, backing off (cooldown active)");
      } else if (
        regularResult.status === "rejected" &&
        resaleResult.status === "rejected"
      ) {
        interval.onError();
        logger.warn("Both endpoints failed, backing off");
      } else {
        interval.onIdle();
      }
    } catch (err) {
      if (signal.aborted) break;
      interval.onError();
      logger.error({ error: (err as Error).message }, "Poll cycle error");
    }

    await interval.wait(signal);
  }

  throw new Error("Polling aborted");
}
