import { request } from "undici";
import { logger } from "../utils/logger.js";
import type { CategorizedSeat } from "../types/api.js";

/**
 * Send a Telegram notification about a successfully selected seat.
 */
export async function sendTelegramAlert(
  botToken: string,
  chatId: string,
  seat: CategorizedSeat,
  eventName: string,
): Promise<void> {
  const { seat: s, source } = seat;
  const message = [
    `<b>🎟️ Ticket Selected!</b>`,
    ``,
    `<b>Event:</b> ${escapeHtml(eventName)}`,
    `<b>Area:</b> ${s.areaId}`,
    `<b>Row (Y):</b> ${s.yCoord}`,
    `<b>Seat (X):</b> ${s.xCoord}`,
    `<b>Price:</b> £${s.price}`,
    `<b>Type:</b> ${source}`,
    ``,
    `⚡ Go to checkout NOW!`,
  ].join("\n");

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const { statusCode, body } = await request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });

    const responseText = await body.text();
    if (statusCode >= 400) {
      logger.error(
        { statusCode, response: responseText },
        "Telegram notification failed",
      );
    } else {
      logger.info("Telegram notification sent");
    }
  } catch (err) {
    logger.error(
      { error: (err as Error).message },
      "Failed to send Telegram notification",
    );
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
