import { request, Pool } from "undici";
import { logger } from "../utils/logger.js";
import { HttpError, withRetry, type RetryOptions } from "./retry.js";
import type {
  AvailableSeatsResponse,
  BasketCountResponse,
  BlockResponse,
  EventConfig,
  SelectSeatRequest,
} from "../types/api.js";

const BASE_URL = "https://www.eticketing.co.uk";

export interface ApiClientOptions {
  cookieString: string;
  userAgent: string;
  signal?: AbortSignal;
}

export interface SeatQueryParams {
  eventId: string;
  quantity: number;
  together: boolean;
  minPrice: number;
  maxPrice: number;
}

export class ApiClient {
  private cookieString: string;
  private userAgent: string;
  private signal?: AbortSignal;
  private pool: Pool;

  /** Cached common headers — invalidated on updateCookies() */
  private cachedHeaders: Record<string, string> | null = null;

  /** Cached query strings — set once via cacheQueryStrings() */
  private cachedRegularQs: string | null = null;
  private cachedResaleQs: string | null = null;

  constructor(opts: ApiClientOptions) {
    this.cookieString = opts.cookieString;
    this.userAgent = opts.userAgent;
    this.signal = opts.signal;
    this.pool = new Pool(BASE_URL, {
      connections: 12,
      pipelining: 1,
    });
  }

  /** Close the connection pool. Call from finally block. */
  async close(): Promise<void> {
    await this.pool.close();
  }

  updateCookies(cookieString: string): void {
    this.cookieString = cookieString;
    this.cachedHeaders = null; // invalidate
  }

  getCookieString(): string {
    return this.cookieString;
  }

  private commonHeaders(): Record<string, string> {
    if (this.cachedHeaders) return this.cachedHeaders;
    this.cachedHeaders = {
      Cookie: this.cookieString,
      "User-Agent": this.userAgent,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BASE_URL}/arsenal/`,
      Origin: BASE_URL,
    };
    return this.cachedHeaders;
  }

  /** Pre-compute and cache the query strings for regular and resale polling */
  cacheQueryStrings(params: SeatQueryParams): void {
    this.cachedRegularQs = this.buildSeatQueryString(params);
    this.cachedResaleQs = this.buildSeatQueryString(params, { MarketType: "1" });
  }

  private buildSeatQueryString(params: SeatQueryParams, extra?: Record<string, string>): string {
    const qs = new URLSearchParams({
      AreSeatsTogether: String(params.together),
      EventId: params.eventId,
      MaximumPrice: String(params.maxPrice * 100), // API expects pence
      MinimumPrice: String(params.minPrice * 100),
      Quantity: String(params.quantity),
      ...extra,
    });
    return qs.toString();
  }

  private async doGet<T>(path: string, retryOpts?: RetryOptions): Promise<T> {
    return withRetry(
      async () => {
        const { statusCode, body } = await request(`${BASE_URL}${path}`, {
          method: "GET",
          headers: this.commonHeaders(),
          signal: this.signal,
          dispatcher: this.pool,
        });
        if (statusCode >= 400) {
          const text = await body.text();
          throw new HttpError(statusCode, text);
        }
        return (await body.json()) as T;
      },
      `GET ${path.split("?")[0]}`,
      { signal: this.signal, ...retryOpts },
    );
  }

  private async doRawPut(
    path: string,
    payload: unknown,
    retryOpts?: RetryOptions,
  ): Promise<string> {
    return withRetry(
      async () => {
        const { statusCode, body } = await request(`${BASE_URL}${path}`, {
          method: "PUT",
          headers: {
            ...this.commonHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: this.signal,
          dispatcher: this.pool,
        });
        const text = await body.text();
        if (statusCode >= 400) throw new HttpError(statusCode, text);
        return text;
      },
      `PUT ${path}`,
      { signal: this.signal, ...retryOpts },
    );
  }

  private async doPost<T>(
    path: string,
    payload?: unknown,
    retryOpts?: RetryOptions,
  ): Promise<T> {
    return withRetry(
      async () => {
        const { statusCode, body } = await request(`${BASE_URL}${path}`, {
          method: "POST",
          headers: {
            ...this.commonHeaders(),
            "Content-Type": "application/json",
          },
          body: payload ? JSON.stringify(payload) : undefined,
          signal: this.signal,
          dispatcher: this.pool,
        });
        if (statusCode >= 400) {
          const text = await body.text();
          throw new HttpError(statusCode, text);
        }
        return (await body.json()) as T;
      },
      `POST ${path}`,
      { signal: this.signal, ...retryOpts },
    );
  }

  async getEventConfig(eventId: string): Promise<EventConfig> {
    logger.debug({ eventId }, "Fetching event config");
    return this.doGet<EventConfig>(`/arsenal/EDP/Event/Config/${eventId}`);
  }

  async getAvailableRegular(
    params: SeatQueryParams,
    retryOpts?: RetryOptions,
  ): Promise<AvailableSeatsResponse | BlockResponse> {
    const qs = this.cachedRegularQs ?? this.buildSeatQueryString(params);
    return this.doGet<AvailableSeatsResponse | BlockResponse>(
      `/arsenal/EDP/Seats/AvailableRegular?${qs}`,
      { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 500, ...retryOpts },
    );
  }

  async getAvailableResale(
    params: SeatQueryParams,
    retryOpts?: RetryOptions,
  ): Promise<AvailableSeatsResponse | BlockResponse> {
    const qs = this.cachedResaleQs ?? this.buildSeatQueryString(params, { MarketType: "1" });
    return this.doGet<AvailableSeatsResponse | BlockResponse>(
      `/arsenal/EDP/Seats/AvailableResale?${qs}`,
      { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 500, ...retryOpts },
    );
  }

  /**
   * Select a seat. Returns true if success (response length === 8).
   */
  async selectRegularSeat(payload: SelectSeatRequest): Promise<boolean> {
    logger.info({ eventId: payload.EventId, seats: payload.Seats.length }, "Selecting regular seat");
    const text = await this.doRawPut("/arsenal/EDP/Ism/SelectRegularSeat", payload, { maxRetries: 0 });
    return text.length === 8;
  }

  async selectResaleSeat(payload: SelectSeatRequest): Promise<boolean> {
    logger.info({ eventId: payload.EventId, seats: payload.Seats.length }, "Selecting resale seat");
    const text = await this.doRawPut("/arsenal/EDP/Ism/SelectResaleSeat", payload, { maxRetries: 0 });
    return text.length === 8;
  }

  async getBasketCount(): Promise<BasketCountResponse> {
    return this.doPost<BasketCountResponse>("/arsenal/Checkout/Basket/ItemsCount");
  }

  async startBasketTimer(): Promise<unknown> {
    return this.doPost("/arsenal/Checkout/BasketTimer/RedesignSummaryTimer");
  }

  async verifyLogin(): Promise<boolean> {
    try {
      await this.doGet("/arsenal/tagManager/GetPageViewedDataLayer", {
        maxRetries: 1,
      });
      return true;
    } catch {
      return false;
    }
  }
}
