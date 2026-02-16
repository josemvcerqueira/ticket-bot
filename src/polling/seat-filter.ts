import type {
  AreaAvailability,
  AvailableSeatsResponse,
  BlockResponse,
  FlatSeat,
  PriceCategoryMap,
} from "../types/api.js";

export interface SeatFilterOptions {
  minPrice: number;
  maxPrice: number;
  preferredBlocks: string[];
  /** Price categories in range (from event config), used for regular seats */
  priceCategoriesInRange: Set<string>;
}

/**
 * Check if a response is a rate-limit block response.
 */
export function isBlockResponse(
  resp: AvailableSeatsResponse | BlockResponse,
): resp is BlockResponse {
  return (
    !Array.isArray(resp) &&
    typeof resp === "object" &&
    "response" in resp &&
    resp.response === "block"
  );
}

/**
 * Parse the price from TotalValueFormatted (e.g. "£75.00" → 75).
 * Format is always "£XX.XX", so strip the leading currency symbol.
 */
function parsePriceFormatted(formatted: string): number {
  return parseFloat(formatted.substring(1)) || 0;
}

/** Maximum number of individual seats to expand — avoids allocating thousands of objects */
const SEAT_LIMIT = 50;

/** A filtered (area, band, price) tuple for sorting before seat expansion */
interface BandTuple {
  areaId: number;
  priceBandCode: string;
  price: number;
  intervals: { YCoord: number; StartXCoord: number; EndXCoord: number }[];
}

/**
 * Flatten the hierarchical seat response into individual FlatSeat objects.
 * Sorts at the price-band level (~10-50 tuples) instead of per-seat (~thousands).
 * For regular seats: filters by priceCategoriesInRange (PriceBandCode).
 * For resale seats: filters by parsed price from TotalValueFormatted.
 */
export function flattenSeats(
  areas: AreaAvailability[],
  mode: "regular" | "resale",
  opts: SeatFilterOptions,
): FlatSeat[] {
  // Collect filtered band tuples
  const bands: BandTuple[] = [];

  for (const area of areas) {
    for (const band of area.PriceBands) {
      // For regular: check if this price band is in the accepted range
      if (mode === "regular" && !opts.priceCategoriesInRange.has(band.PriceBandCode)) {
        continue;
      }

      // For resale: check the formatted price
      const price = parsePriceFormatted(band.TotalValueFormatted);
      if (mode === "resale" && (price < opts.minPrice || price > opts.maxPrice)) {
        continue;
      }

      bands.push({
        areaId: area.AreaId,
        priceBandCode: band.PriceBandCode,
        price,
        intervals: band.AvailableSeatsIntervals,
      });
    }
  }

  // Sort bands by price ascending (~10-50 items)
  bands.sort((a, b) => a.price - b.price);

  // Expand intervals in sorted order, capped at SEAT_LIMIT
  const seats: FlatSeat[] = [];
  outer: for (const band of bands) {
    for (const interval of band.intervals) {
      for (let x = interval.StartXCoord; x <= interval.EndXCoord; x++) {
        seats.push({
          areaId: band.areaId,
          yCoord: interval.YCoord,
          xCoord: x,
          priceBandCode: band.priceBandCode,
          price: band.price,
        });
        if (seats.length >= SEAT_LIMIT) break outer;
      }
    }
  }

  return seats;
}

/**
 * Build the set of price categories that fall within the min/max price range.
 * Used for filtering regular seats by PriceBandCode.
 */
export function buildPriceCategoriesInRange(
  priceCategoryMap: PriceCategoryMap,
  adultPrices: Map<string, number>,
  minPrice: number,
  maxPrice: number,
): Set<string> {
  const inRange = new Set<string>();
  for (const [category, priceInPence] of adultPrices) {
    const priceInPounds = priceInPence / 100;
    if (priceInPounds >= minPrice && priceInPounds <= maxPrice) {
      inRange.add(category);
    }
  }
  return inRange;
}
