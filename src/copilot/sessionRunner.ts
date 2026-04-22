import { spawn } from "node:child_process";
import { config } from "../config";
import { logger } from "../logger";

type RunCopilotOptions = {
  prompt: string;
  model?: string;
  copilotSessionId?: string | null;
  cwd: string;
  onChunk: (chunk: string) => void;
  signal: AbortSignal;
};

type RunCopilotResult = {
  code: number;
  copilotSessionId: string | null;
};

function parseArgsJson(raw: string): string[] {
  let args: string[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      throw new Error("must be a JSON array of strings");
    }
    args = parsed;
  } catch (error) {
    throw new Error((error as Error).message);
  }

  return args;
}

function buildArgs(prompt: string, model?: string, copilotSessionId?: string | null): string[] {
  const isResume = !!copilotSessionId && copilotSessionId.trim().length > 0;
  const rawArgs = isResume ? config.COPILOT_RESUME_ARGS_JSON : config.COPILOT_ARGS_JSON;
  let args: string[];

  try {
    args = parseArgsJson(rawArgs);
  } catch (error) {
    const key = isResume ? "COPILOT_RESUME_ARGS_JSON" : "COPILOT_ARGS_JSON";
    throw new Error(`Invalid ${key}: ${(error as Error).message}`);
  }

  let normalized = args.map((value) => value.replaceAll("{{prompt}}", prompt));

  if (model && model.trim().length > 0) {
    normalized = normalized.map((value) => value.replaceAll("{{model}}", model.trim()));
  }

  if (isResume) {
    normalized = normalized.map((value) => value.replaceAll("{{copilotSessionId}}", copilotSessionId!.trim()));
  }

  // Backward compatibility: older config used ["exec", "--prompt", ...].
  if (normalized[0] === "exec") {
    normalized = normalized.slice(1);
  }

  if (normalized.some((value) => value.includes("{{copilotSessionId}}"))) {
    throw new Error(
      "Invalid Copilot args template: unresolved {{copilotSessionId}} placeholder. Provide session ID or adjust config."
    );
  }

  const hasPromptFlag =
    normalized.includes("--prompt") ||
    normalized.includes("-p") ||
    normalized.includes("--interactive") ||
    normalized.includes("-i");

  if (!hasPromptFlag) {
    throw new Error(
      "Invalid COPILOT_ARGS_JSON: include -p/--prompt (or -i/--interactive) for Copilot CLI input."
    );
  }

  const isNonInteractive = normalized.includes("--prompt") || normalized.includes("-p");
  if (isNonInteractive) {
    const hasApprovalFlag =
      normalized.includes("--allow-all-tools") ||
      normalized.includes("--allow-all") ||
      normalized.includes("--yolo");

    if (!hasApprovalFlag) {
      normalized.push("--allow-all-tools");
    }

    if (!normalized.includes("--silent")) {
      normalized.push("--silent");
    }
  }

  const hasModelFlag = normalized.includes("--model");
  if (!hasModelFlag && model && model.trim().length > 0) {
    normalized.push("--model", model.trim());
  }

  return normalized;
}

function extractSessionId(content: string): string | null {
  const patterns = [
    /"sessionId"\s*:\s*"([^"]+)"/i,
    /"session_id"\s*:\s*"([^"]+)"/i,
    /session(?:\s|_|-)?id\s*[:=]\s*([A-Za-z0-9_-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

export async function runCopilotSession(options: RunCopilotOptions): Promise<RunCopilotResult> {
  const args = buildArgs(options.prompt, options.model, options.copilotSessionId);
  const childEnv = { ...process.env };
  let discoveredSessionId = options.copilotSessionId?.trim() || null;
  const isResume = !!options.copilotSessionId?.trim();
  const sessionLogger = logger.child({
    cwd: options.cwd,
    model: options.model,
    isResume,
    requestedCopilotSessionId: options.copilotSessionId || null,
    promptLength: options.prompt.length,
  });

  // Force Copilot CLI to use machine login/device flow session instead of token env vars.
  delete childEnv.GH_TOKEN;
  delete childEnv.GITHUB_TOKEN;
  delete childEnv.COPILOT_GITHUB_TOKEN;
  delete childEnv.GITHUB_API_TOKEN;
  sessionLogger.info({ command: config.COPILOT_COMMAND, args }, "Starting Copilot CLI process");

  return await new Promise<RunCopilotResult>((resolve, reject) => {
    const child = spawn(config.COPILOT_COMMAND, args, {
      cwd: options.cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      sessionLogger.warn({ timeoutMs: config.COPILOT_TIMEOUT_MS }, "Copilot CLI timed out, sending SIGTERM");
      child.kill("SIGTERM");
    }, config.COPILOT_TIMEOUT_MS);

    options.signal.addEventListener("abort", () => {
      sessionLogger.warn("Abort signal received, terminating Copilot CLI process");
      child.kill("SIGTERM");
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (!discoveredSessionId) {
        const extracted = extractSessionId(chunk);
        if (extracted) {
          discoveredSessionId = extracted;
          sessionLogger.info({ discoveredSessionId }, "Discovered Copilot session ID from stdout");
        }
      }
      sessionLogger.debug({ chunkLength: chunk.length }, "Received Copilot stdout chunk");
      options.onChunk(chunk);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (!discoveredSessionId) {
        const extracted = extractSessionId(chunk);
        if (extracted) {
          discoveredSessionId = extracted;
          sessionLogger.info({ discoveredSessionId }, "Discovered Copilot session ID from stderr");
        }
      }
      sessionLogger.warn({ chunkLength: chunk.length }, "Received Copilot stderr chunk");
      options.onChunk(`\n[stderr] ${chunk}`);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      sessionLogger.error({ err: error }, "Copilot CLI process failed to start or crashed");
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      sessionLogger.info({ exitCode: code ?? 0, discoveredSessionId }, "Copilot CLI process completed");
      resolve({
        code: code ?? 0,
        copilotSessionId: discoveredSessionId,
      });
    });
  });
}
