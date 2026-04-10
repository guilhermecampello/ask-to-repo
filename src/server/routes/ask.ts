import { Router } from "express";
import { ensureMirrorReady } from "../../repo/mirrorManager";
import { runCopilotSession } from "../../copilot/sessionRunner";
import { AskRequest, AskStreamEvent } from "../../shared/types";
import { sanitizeOutputChunk, truncateIfNeeded } from "../security/outputPolicy";
import { askRateLimit } from "../security/rateLimit";
import { getRepoByFullName } from "../../github/client";
import { config, getAvailableModels } from "../../config";

function sendSseEvent(res: RouterResponse, event: AskStreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

type RouterResponse = {
  write: (chunk: string) => void;
  end: () => void;
  setHeader: (name: string, value: string) => void;
  flushHeaders?: () => void;
};

export const askRouter = Router();

function mapCopilotError(error: unknown): string {
  const message = (error as Error)?.message || "Unknown error";
  if (message.includes("No authentication information found")) {
    return (
      "Copilot CLI is not authenticated. Run 'copilot -i \"/login\"' once on the server machine " +
      "or set GH_TOKEN/GITHUB_TOKEN before starting the app."
    );
  }

  return message;
}

askRouter.post("/ask", askRateLimit, async (req, res) => {
  const body = req.body as Partial<AskRequest>;
  const question = body?.question?.trim();
  const repoFullName = body?.repoFullName?.trim();
  const requestedModel = body?.model?.trim();
  const availableModels = getAvailableModels();
  const effectiveModel = requestedModel && requestedModel.length > 0 ? requestedModel : config.COPILOT_DEFAULT_MODEL;

  if (!question) {
    res.status(400).json({ error: "Field 'question' is required." });
    return;
  }

  if (!repoFullName) {
    res.status(400).json({ error: "Field 'repoFullName' is required." });
    return;
  }

  if (!availableModels.includes(effectiveModel)) {
    res.status(400).json({
      error: `Invalid model '${effectiveModel}'. Allowed models: ${availableModels.join(", ")}`,
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const abortController = new AbortController();
  req.on("close", () => {
    abortController.abort();
  });

  try {
    sendSseEvent(res, { type: "status", message: "Preparing repository context..." });
    const repo = await getRepoByFullName(repoFullName);
    const mirror = await ensureMirrorReady(repo);
    const cwd = mirror.path;

    sendSseEvent(res, { type: "status", message: "Starting Copilot CLI session..." });

    let aggregate = "";
    const code = await runCopilotSession({
      prompt: question,
      model: effectiveModel,
      cwd,
      signal: abortController.signal,
      onChunk: (chunk) => {
        const safeChunk = sanitizeOutputChunk(chunk);
        aggregate += safeChunk;
        const trunc = truncateIfNeeded(aggregate);
        if (trunc.truncated) {
          aggregate = trunc.value;
          sendSseEvent(res, { type: "chunk", content: trunc.value });
          abortController.abort();
          return;
        }
        sendSseEvent(res, { type: "chunk", content: safeChunk });
      },
    });

    sendSseEvent(res, { type: "done", code });
  } catch (error) {
    sendSseEvent(res, {
      type: "error",
      message: mapCopilotError(error),
    });
  } finally {
    res.end();
  }
});
