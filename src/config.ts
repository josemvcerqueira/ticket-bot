import "dotenv/config";
import { z } from "zod";

const configSchema = z.object({
  EMAIL: z.string().email(),
  PASSWORD: z.string().min(1),
  MIN_PRICE: z.coerce.number().min(0).default(0),
  MAX_PRICE: z.coerce.number().min(0).default(100),
  QUANTITY: z.coerce.number().int().min(1).default(1),
  TOGETHER: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  POLL_MIN_INTERVAL_MS: z.coerce.number().min(100).default(500),
  POLL_MAX_INTERVAL_MS: z.coerce.number().min(1000).default(10_000),
  POLL_INITIAL_INTERVAL_MS: z.coerce.number().min(100).default(2000),
  PREFERRED_BLOCKS: z
    .string()
    .default("")
    .transform((v) => (v ? v.split(",").map((s) => s.trim()) : [])),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return result.data;
}
