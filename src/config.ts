import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(20),
  GITHUB_API_BASE_URL: z.string().url().default("https://api.github.com"),
  REPO_LOCAL_PATH: z.string().default(path.resolve(process.cwd(), ".local/repo-mirror")),
  SESSIONS_FILE_PATH: z.string().default(path.resolve(process.cwd(), ".local/sessions/chats.json")),
  COPILOT_COMMAND: z.string().default("copilot"),
  COPILOT_DEFAULT_MODEL: z.string().default("gpt-5-mini"),
  COPILOT_AVAILABLE_MODELS_JSON: z
    .string()
    .default('["gpt-5-mini","raptor-mini","gpt-5","claude-sonnet-4.5"]'),
  COPILOT_ARGS_JSON: z
    .string()
    .default('["--prompt","{{prompt}}","--reasoning-effort","medium","--allow-all-tools","--silent"]'),
  COPILOT_RESUME_ARGS_JSON: z
    .string()
    .default(
      '["--prompt","{{prompt}}","--reasoning-effort","medium","--allow-all-tools","--silent","--resume","{{copilotSessionId}}"]'
    ),
  COPILOT_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

export function getAvailableModels(): string[] {
  try {
    const parsed = JSON.parse(config.COPILOT_AVAILABLE_MODELS_JSON);
    if (!Array.isArray(parsed)) {
      throw new Error("COPILOT_AVAILABLE_MODELS_JSON must be an array");
    }

    const models = parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (!models.includes(config.COPILOT_DEFAULT_MODEL)) {
      models.unshift(config.COPILOT_DEFAULT_MODEL);
    }

    return Array.from(new Set(models));
  } catch (error) {
    throw new Error(`Invalid COPILOT_AVAILABLE_MODELS_JSON: ${(error as Error).message}`);
  }
}
