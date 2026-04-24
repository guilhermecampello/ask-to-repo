import { Router } from "express";
import { ensureMirrorReady } from "../../repo/mirrorManager";
import { runCopilotSession } from "../../copilot/sessionRunner";
import { OutputStreamParser } from "../../copilot/outputParser";
import { AskRequest, AskStreamEvent } from "../../shared/types";
import { sanitizeOutputChunk, truncateIfNeeded } from "../security/outputPolicy";
import { askRateLimit } from "../security/rateLimit";
import { getRepoByFullName } from "../../github/client";
import { config } from "../../config";
import { appendChatMessage, ensureChatSessionId, getChatById, updateChatSessionId, updateChatTitleIfNeeded } from "../../session/chatStore";
import { logger } from "../../logger";

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

function buildBootstrapPrompt(chat: NonNullable<Awaited<ReturnType<typeof getChatById>>>, question: string): string {
  const priorMessages = chat.messages
    .slice(-12)
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content.trim()}`)
    .join("\n\n");

  if (!priorMessages) {
    return question;
  }

  return [
    "Continue this existing chat. The following transcript is prior context from the same conversation.",
    "Preserve the ongoing context and answer the final user message as the next turn.",
    "",
    "Transcript:",
    priorMessages,
    "",
    `User: ${question}`,
  ].join("\n");
}

function summarizeTitleText(value: string): string {
  const cleaned = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s*(please|can you|could you|i need|help me|let'?s|lets|would you)\s+/i, "")
    .replace(/["'`]/g, "")
    .trim();

  if (!cleaned) {
    return "";
  }

  const strippedPunctuation = cleaned.replace(/[?!.,;:]+$/g, "").trim();
  if (!strippedPunctuation) {
    return "";
  }

  const bounded = strippedPunctuation.length > 72
    ? `${strippedPunctuation.slice(0, 69).trimEnd()}...`
    : strippedPunctuation;

  return bounded.charAt(0).toUpperCase() + bounded.slice(1);
}

function buildSuggestedTitleFromMessages(chat: NonNullable<Awaited<ReturnType<typeof getChatById>>>): string | null {
  const userMessages = chat.messages.filter((message) => message.role === "user");
  if (userMessages.length === 0) {
    return null;
  }

  const latest = userMessages[userMessages.length - 1]?.content || "";
  const previous = userMessages[userMessages.length - 2]?.content || "";

  let candidate = summarizeTitleText(latest);
  if (candidate.length < 16 && previous) {
    candidate = summarizeTitleText(`${previous} - ${latest}`);
  }

  return candidate || null;
}

async function refreshChatTitleIfNeeded(
  chat: NonNullable<Awaited<ReturnType<typeof getChatById>>>,
  requestLogger: { debug: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
  reason: "user-message" | "assistant-message"
): Promise<void> {
  const proposed = buildSuggestedTitleFromMessages(chat);
  if (!proposed) {
    requestLogger.debug({ reason }, "Skipped chat title refresh (no proposed title)");
    return;
  }

  const updated = await updateChatTitleIfNeeded(chat.id, proposed);
  if (!updated) {
    requestLogger.warn({ reason, proposedTitle: proposed }, "Failed to refresh chat title (chat missing)");
    return;
  }

  requestLogger.debug(
    { reason, proposedTitle: proposed, resultingTitle: updated.title },
    "Processed chat title refresh"
  );
}

askRouter.post("/ask", askRateLimit, async (req, res) => {
  const body = req.body as Partial<AskRequest>;
  const question = body?.question?.trim();
  const repoFullName = body?.repoFullName?.trim();
  const chatId = body?.chatId?.trim();
  const requestedModel = body?.model?.trim();
  const effectiveModel = requestedModel && requestedModel.length > 0 ? requestedModel : config.COPILOT_DEFAULT_MODEL;
  const requestLogger = logger.child({
    route: "POST /api/ask",
    chatId: chatId || null,
    repoFullName: repoFullName || null,
    requestedModel: requestedModel || null,
    effectiveModel,
    questionLength: question?.length || 0,
  });

  requestLogger.info("Received ask request");

  if (!question) {
    requestLogger.warn("Rejected ask request without question");
    res.status(400).json({ error: "Field 'question' is required." });
    return;
  }

  if (!repoFullName) {
    requestLogger.warn("Rejected ask request without repoFullName");
    res.status(400).json({ error: "Field 'repoFullName' is required." });
    return;
  }

  if (!chatId) {
    requestLogger.warn("Rejected ask request without chatId");
    res.status(400).json({ error: "Field 'chatId' is required." });
    return;
  }

  const chat = await getChatById(chatId);
  if (!chat) {
    requestLogger.warn("Rejected ask request for missing chat");
    res.status(404).json({ error: `Chat '${chatId}' not found.` });
    return;
  }

  if (chat.repoFullName !== repoFullName) {
    requestLogger.warn({ chatRepoFullName: chat.repoFullName }, "Rejected ask request due to repo mismatch for chat");
    res.status(400).json({
      error: `Chat '${chatId}' belongs to '${chat.repoFullName}', but request repo is '${repoFullName}'.`,
    });
    return;
  }

  const chatAfterUserMessage = await appendChatMessage({
    chatId,
    role: "user",
    content: question,
    model: effectiveModel,
  });
  if (chatAfterUserMessage) {
    await refreshChatTitleIfNeeded(chatAfterUserMessage, requestLogger, "user-message");
  }
  requestLogger.debug({ existingMessageCount: chat.messages.length }, "Persisted user message before Copilot execution");

  const sessionReadyChat = await ensureChatSessionId(chatId);
  if (!sessionReadyChat) {
    requestLogger.error("Chat disappeared while ensuring session ID");
    res.status(404).json({ error: `Chat '${chatId}' not found.` });
    return;
  }

  const hadExistingTranscript = !chat.copilotSessionId && chat.messages.length > 0;
  const effectivePrompt = hadExistingTranscript ? buildBootstrapPrompt(chat, question) : question;
  requestLogger.info(
    {
      existingCopilotSessionId: chat.copilotSessionId,
      activeCopilotSessionId: sessionReadyChat.copilotSessionId,
      hadExistingTranscript,
      bootstrapPromptLength: hadExistingTranscript ? effectivePrompt.length : 0,
    },
    "Prepared Copilot session state for ask request"
  );

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const abortController = new AbortController();
  req.on("close", () => {
    requestLogger.warn("HTTP client closed connection during ask stream");
    abortController.abort();
  });

  try {
    sendSseEvent(res, { type: "status", message: "Preparing repository context..." });
    requestLogger.info("Resolving repository and mirror context");
    const repo = await getRepoByFullName(repoFullName);
    const mirror = await ensureMirrorReady(repo);
    const cwd = mirror.path;
    requestLogger.info({ mirrorPath: cwd, mirrorSynced: mirror.synced }, "Repository context prepared");

    sendSseEvent(res, { type: "status", message: "Starting Copilot CLI session..." });
    requestLogger.info("Starting Copilot streaming session");

    const parser = new OutputStreamParser(requestLogger);
    let aggregate = "";
    let toolActivityAggregate = "";
    let streamedChunkCount = 0;
    const result = await runCopilotSession({
      prompt: effectivePrompt,
      model: effectiveModel,
      copilotSessionId: sessionReadyChat.copilotSessionId,
      cwd,
      signal: abortController.signal,
      onChunk: (chunk) => {
        streamedChunkCount += 1;
        const safeChunk = sanitizeOutputChunk(chunk);
        requestLogger.debug({ chunkIndex: streamedChunkCount, rawLen: chunk.length }, "parser:raw-chunk");
        const segments = parser.push(safeChunk);
        for (const seg of segments) {
          if (seg.kind === "tool") {
            toolActivityAggregate += seg.content;
            sendSseEvent(res, { type: "tool_activity", content: seg.content });
          } else {
            aggregate += seg.content;
            const trunc = truncateIfNeeded(aggregate);
            if (trunc.truncated) {
              aggregate = trunc.value;
              requestLogger.warn({ streamedChunkCount, aggregateLength: aggregate.length }, "Response exceeded output policy and was truncated");
              sendSseEvent(res, { type: "chunk", content: trunc.value });
              abortController.abort();
              return;
            }
            sendSseEvent(res, { type: "chunk", content: seg.content });
          }
        }
      },
    });

    for (const seg of parser.flush()) {
      if (seg.kind === "tool") {
        toolActivityAggregate += seg.content;
        sendSseEvent(res, { type: "tool_activity", content: seg.content });
      } else if (seg.content) {
        aggregate += seg.content;
        sendSseEvent(res, { type: "chunk", content: seg.content });
      }
    }

    if (result.copilotSessionId) {
      await updateChatSessionId(chatId, result.copilotSessionId);
    }

    const chatAfterAssistantMessage = await appendChatMessage({
      chatId,
      role: "assistant",
      content: aggregate,
      model: effectiveModel,
      toolActivity: toolActivityAggregate || undefined,
    });
    if (chatAfterAssistantMessage) {
      await refreshChatTitleIfNeeded(chatAfterAssistantMessage, requestLogger, "assistant-message");
    }
    requestLogger.info(
      {
        exitCode: result.code,
        streamedChunkCount,
        responseLength: aggregate.length,
        resultingCopilotSessionId: result.copilotSessionId,
      },
      "Ask request completed successfully"
    );

    sendSseEvent(res, {
      type: "done",
      code: result.code,
      chatId,
      copilotSessionId: result.copilotSessionId,
    });
  } catch (error) {
    const mappedError = mapCopilotError(error);
    await appendChatMessage({
      chatId,
      role: "assistant",
      content: `[error] ${mappedError}`,
      model: effectiveModel,
    });
    requestLogger.error({ err: error, mappedError }, "Ask request failed");

    sendSseEvent(res, {
      type: "error",
      message: mappedError,
    });
  } finally {
    requestLogger.debug("Closing ask SSE response");
    res.end();
  }
});
