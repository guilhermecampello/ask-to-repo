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
    .default('["--prompt","{{prompt}}","--allow-all-tools"]'),
  COPILOT_RESUME_ARGS_JSON: z
    .string()
    .default(
      '["--prompt","{{prompt}}","--allow-all-tools","--resume","{{copilotSessionId}}"]'
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

export type AvailableModelOption = {
  id: string;
  label: string;
  requestMultiplier: string;
};

const AVAILABLE_MODEL_OPTIONS: AvailableModelOption[] = [
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5", requestMultiplier: "0.33x" },
  { id: "claude-sonnet-4", label: "Claude Sonnet 4", requestMultiplier: "1x" },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", requestMultiplier: "1x" },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", requestMultiplier: "1x" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", requestMultiplier: "1x" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash (Preview)", requestMultiplier: "0.33x" },
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro (Preview)", requestMultiplier: "1x" },
  { id: "gpt-4.1", label: "GPT-4.1", requestMultiplier: "0x" },
  { id: "gpt-4o", label: "GPT-4o", requestMultiplier: "0x" },
  { id: "gpt-5-mini", label: "GPT-5 mini", requestMultiplier: "0x" },
  { id: "gpt-5.2", label: "GPT-5.2", requestMultiplier: "1x" },
  { id: "gpt-5.2-codex", label: "GPT-5.2-Codex", requestMultiplier: "1x" },
  { id: "gpt-5.3-codex", label: "GPT-5.3-Codex", requestMultiplier: "1x" },
  { id: "gpt-5.4", label: "GPT-5.4", requestMultiplier: "1x" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", requestMultiplier: "0.33x" },
  { id: "grok-code-fast-1", label: "Grok Code Fast 1", requestMultiplier: "0.25x" },
  { id: "raptor-mini", label: "Raptor mini (Preview)", requestMultiplier: "0x" },
];

export function getAvailableModelOptions(): AvailableModelOption[] {
  return AVAILABLE_MODEL_OPTIONS.map((option) => ({ ...option }));
}

export function getAvailableModels(): string[] {
  return getAvailableModelOptions().map((option) => option.id);
}
