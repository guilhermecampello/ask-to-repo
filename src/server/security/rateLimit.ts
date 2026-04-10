import rateLimit from "express-rate-limit";
import { config } from "../../config";

export const askRateLimit = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
});
