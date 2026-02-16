/** Cookie extracted from browser via CDP */
export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  expires?: number;
}

/** Event listing scraped from the events page */
export interface EventListItem {
  id: string;
  name: string;
  date: string;
  url: string;
}

// ── Event Config (/arsenal/EDP/Event/Config/{eventId}) ──

export interface PriceEntry {
  PriceTypeDescription: string;
  PriceCategory: string;
  PriceType: number;
  /** Price in pence (divide by 100 for pounds) */
  TotalFaceValue: number;
}

export interface EventConfigPrices {
  Prices: PriceEntry[];
}

export interface EventConfig {
  Prices: EventConfigPrices;
  [key: string]: unknown;
}

/**
 * Mapping of PriceCategory → PriceType, used as PriceClassId
 * when selecting seats.
 */
export type PriceCategoryMap = Map<string, number>;

// ── Available Seats ──

export interface SeatInterval {
  YCoord: number;
  StartXCoord: number;
  EndXCoord: number;
}

export interface PriceBand {
  PriceBandCode: string;
  TotalValueFormatted: string;
  AvailableSeatsIntervals: SeatInterval[];
}

export interface AreaAvailability {
  AreaId: number;
  PriceBands: PriceBand[];
}

/**
 * Response from /arsenal/EDP/Seats/AvailableRegular or AvailableResale.
 * This is a JSON array of AreaAvailability objects.
 * A special {"response": "block"} response indicates rate limiting.
 */
export type AvailableSeatsResponse = AreaAvailability[];

export interface BlockResponse {
  response: "block";
}

// ── Flattened seat for internal use ──

export interface FlatSeat {
  areaId: number;
  yCoord: number;
  xCoord: number;
  priceBandCode: string;
  /** Price in pounds, parsed from TotalValueFormatted */
  price: number;
}

/** A seat with its source type (regular or resale) */
export interface CategorizedSeat {
  seat: FlatSeat;
  source: "regular" | "resale";
}

// ── Select Seat ──

export interface SelectSeatRequestSeat {
  AreaId: number;
  XCoordinate: number;
  YCoordinate: number;
  PriceClassId: number;
  IsSecondaryMarket: boolean;
}

export interface SelectSeatRequest {
  EventId: number;
  Seats: SelectSeatRequestSeat[];
}

/**
 * Seat selection success is determined by response text length === 8.
 * The actual body is opaque.
 */
export type SelectSeatRawResponse = string;

// ── Basket ──

export interface BasketCountResponse {
  Count: number;
}
