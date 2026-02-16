import { logger } from "../utils/logger.js";
import type { ApiClient } from "../http/client.js";
import type { CategorizedSeat, PriceCategoryMap } from "../types/api.js";

/** Number of seats to try concurrently in the first wave */
const FIRST_WAVE_SIZE = 5;
/** Number of seats to try concurrently in each fallback batch */
const FALLBACK_BATCH_SIZE = 5;

/**
 * Attempt to select seats from the categorized list.
 * First wave: try up to FIRST_WAVE_SIZE seats concurrently via Promise.any().
 * Fallback: try remaining seats in batched Promise.any() groups of FALLBACK_BATCH_SIZE.
 * Returns the first successfully selected seat.
 */
export async function selectBestSeat(
  client: ApiClient,
  seats: CategorizedSeat[],
  eventId: number,
  priceCategoryMap: PriceCategoryMap,
): Promise<CategorizedSeat | null> {
  // Filter out seats with no price class mapping up front
  const viable = seats.filter((s) => {
    if (priceCategoryMap.has(s.seat.priceBandCode)) return true;
    logger.debug(
      { priceBandCode: s.seat.priceBandCode },
      "No PriceClassId mapping for band, skipping",
    );
    return false;
  });

  if (viable.length === 0) {
    logger.warn("All seat selection attempts failed");
    return null;
  }

  // First wave — all launched simultaneously
  const firstWave = viable.slice(0, FIRST_WAVE_SIZE);
  const rest = viable.slice(FIRST_WAVE_SIZE);

  const firstResult = await tryBatch(client, firstWave, eventId, priceCategoryMap);
  if (firstResult) return firstResult;

  // Batched fallback for the rest
  for (let i = 0; i < rest.length; i += FALLBACK_BATCH_SIZE) {
    const batch = rest.slice(i, i + FALLBACK_BATCH_SIZE);
    const result = await tryBatch(client, batch, eventId, priceCategoryMap);
    if (result) return result;
  }

  logger.warn("All seat selection attempts failed");
  return null;
}

/** Try a batch of seats concurrently via Promise.any() */
async function tryBatch(
  client: ApiClient,
  seats: CategorizedSeat[],
  eventId: number,
  priceCategoryMap: PriceCategoryMap,
): Promise<CategorizedSeat | null> {
  if (seats.length === 0) return null;

  if (seats.length === 1) {
    return tryOne(client, seats[0], eventId, priceCategoryMap);
  }

  const promises = seats.map(async (categorized) => {
    const result = await tryOne(client, categorized, eventId, priceCategoryMap);
    if (result) return result;
    throw new Error("selection failed");
  });

  try {
    return await Promise.any(promises);
  } catch {
    // All failed
    return null;
  }
}

/** Attempt a single seat selection, returning the seat on success or null */
async function tryOne(
  client: ApiClient,
  categorized: CategorizedSeat,
  eventId: number,
  priceCategoryMap: PriceCategoryMap,
): Promise<CategorizedSeat | null> {
  const { seat, source } = categorized;
  const priceClassId = priceCategoryMap.get(seat.priceBandCode)!;

  const payload = {
    EventId: eventId,
    Seats: [
      {
        AreaId: seat.areaId,
        XCoordinate: seat.xCoord,
        YCoordinate: seat.yCoord,
        PriceClassId: priceClassId,
        IsSecondaryMarket: source === "resale",
      },
    ],
  };

  try {
    const success =
      source === "regular"
        ? await client.selectRegularSeat(payload)
        : await client.selectResaleSeat(payload);

    if (success) {
      logger.info(
        {
          areaId: seat.areaId,
          y: seat.yCoord,
          x: seat.xCoord,
          price: seat.price,
          source,
        },
        "Seat selected successfully!",
      );
      return categorized;
    }

    logger.warn(
      { areaId: seat.areaId, y: seat.yCoord, x: seat.xCoord },
      "Seat selection rejected, trying next",
    );
  } catch (err) {
    logger.warn(
      { areaId: seat.areaId, error: (err as Error).message },
      "Seat selection failed, trying next",
    );
  }

  return null;
}
