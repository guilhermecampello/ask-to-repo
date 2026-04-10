import { spawn } from "node:child_process";
import { config } from "../config";

type RunCopilotOptions = {
  prompt: string;
  model?: string;
  cwd: string;
  onChunk: (chunk: string) => void;
  signal: AbortSignal;
};

function buildArgs(prompt: string, model?: string): string[] {
  let args: string[];
  try {
    const parsed = JSON.parse(config.COPILOT_ARGS_JSON);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      throw new Error("COPILOT_ARGS_JSON must be a JSON array of strings");
    }
    args = parsed;
  } catch (error) {
    throw new Error(`Invalid COPILOT_ARGS_JSON: ${(error as Error).message}`);
  }

  let normalized = args.map((value) => value.replaceAll("{{prompt}}", prompt));

  // Backward compatibility: older config used ["exec", "--prompt", ...].
  if (normalized[0] === "exec") {
    normalized = normalized.slice(1);
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

export async function runCopilotSession(options: RunCopilotOptions): Promise<number> {
  const args = buildArgs(options.prompt, options.model);
  const childEnv = { ...process.env };

  // Force Copilot CLI to use machine login/device flow session instead of token env vars.
  delete childEnv.GH_TOKEN;
  delete childEnv.GITHUB_TOKEN;
  delete childEnv.COPILOT_GITHUB_TOKEN;
  delete childEnv.GITHUB_API_TOKEN;

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(config.COPILOT_COMMAND, args, {
      cwd: options.cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, config.COPILOT_TIMEOUT_MS);

    options.signal.addEventListener("abort", () => {
      child.kill("SIGTERM");
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => options.onChunk(chunk));

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      options.onChunk(`\n[stderr] ${chunk}`);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code ?? 0);
    });
  });
}
