import { logger } from "../utils/logger.js";
import type { ApiClient } from "../http/client.js";

/**
 * Verify that items are in the basket after seat selection.
 * Returns the basket item count.
 */
export async function verifyBasket(client: ApiClient): Promise<number> {
  const result = await client.getBasketCount();
  logger.info({ count: result.Count }, "Basket item count");
  return result.Count;
}
