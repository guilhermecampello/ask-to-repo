import { Router } from "express";
import { config, getAvailableModels } from "../../config";
import {
  ChatRecord,
  createChat,
  getChatById,
  listChatsByRepo,
  setChatTitlePinned,
} from "../../session/chatStore";
import { CreateChatRequest, SetChatTitlePinRequest } from "../../shared/types";
import { logger } from "../../logger";

function toChatSummary(chat: ChatRecord) {
  return {
    id: chat.id,
    repoFullName: chat.repoFullName,
    title: chat.title,
    titlePinned: chat.titlePinned,
    model: chat.model,
    copilotSessionId: chat.copilotSessionId,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
  };
}

function toChatDetail(chat: ChatRecord) {
  return {
    id: chat.id,
    repoFullName: chat.repoFullName,
    title: chat.title,
    titlePinned: chat.titlePinned,
    model: chat.model,
    copilotSessionId: chat.copilotSessionId,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messages: chat.messages,
  };
}

export const chatsRouter = Router();

chatsRouter.get("/chats", async (req, res) => {
  const repoFullName = String(req.query.repoFullName || "").trim();
  const chats = await listChatsByRepo(repoFullName || undefined);
  logger.info({ repoFullName: repoFullName || null, count: chats.length }, "Listed chats via API");
  res.json({ chats: chats.map(toChatSummary) });
});

chatsRouter.post("/chats", async (req, res) => {
  const body = req.body as Partial<CreateChatRequest>;
  const repoFullName = body?.repoFullName?.trim();
  const requestedTitle = body?.title?.trim();
  const requestedModel = body?.model?.trim();
  const requestedSessionId = body?.copilotSessionId?.trim();

  if (!repoFullName) {
    logger.warn("Rejected chat creation request without repoFullName");
    res.status(400).json({ error: "Field 'repoFullName' is required." });
    return;
  }

  const model = requestedModel && requestedModel.length > 0 ? requestedModel : config.COPILOT_DEFAULT_MODEL;
  const availableModels = getAvailableModels();
  if (!availableModels.includes(model)) {
    logger.warn({ repoFullName, model }, "Rejected chat creation request with invalid model");
    res.status(400).json({
      error: `Invalid model '${model}'. Allowed models: ${availableModels.join(", ")}`,
    });
    return;
  }

  const title = requestedTitle && requestedTitle.length > 0 ? requestedTitle : `Chat ${new Date().toLocaleString()}`;

  const chat = await createChat({
    repoFullName,
    model,
    title,
    copilotSessionId: requestedSessionId || null,
  });

  const hydratedChat = await getChatById(chat.id);
  logger.info(
    { chatId: chat.id, repoFullName, model, hasRequestedSessionId: !!requestedSessionId },
    "Created chat via API"
  );
  res.status(201).json({ chat: toChatDetail(hydratedChat || chat) });
});

chatsRouter.get("/chats/:chatId", async (req, res) => {
  const chatId = String(req.params.chatId || "").trim();

  if (!chatId) {
    logger.warn("Rejected chat fetch request without chatId");
    res.status(400).json({ error: "Field 'chatId' is required." });
    return;
  }

  const chat = await getChatById(chatId);
  if (!chat) {
    logger.warn({ chatId }, "Requested chat not found via API");
    res.status(404).json({ error: `Chat '${chatId}' not found.` });
    return;
  }

  logger.debug({ chatId, repoFullName: chat.repoFullName, messageCount: chat.messages.length }, "Fetched chat via API");
  res.json({ chat: toChatDetail(chat) });
});

chatsRouter.patch("/chats/:chatId/title-pin", async (req, res) => {
  const chatId = String(req.params.chatId || "").trim();
  const body = req.body as Partial<SetChatTitlePinRequest>;

  if (!chatId) {
    logger.warn("Rejected title pin request without chatId");
    res.status(400).json({ error: "Field 'chatId' is required." });
    return;
  }

  if (typeof body.pinned !== "boolean") {
    logger.warn({ chatId }, "Rejected title pin request with invalid pinned value");
    res.status(400).json({ error: "Field 'pinned' must be a boolean." });
    return;
  }

  const chat = await setChatTitlePinned(chatId, body.pinned);
  if (!chat) {
    logger.warn({ chatId }, "Requested chat not found for title pin update");
    res.status(404).json({ error: `Chat '${chatId}' not found.` });
    return;
  }

  logger.info({ chatId, titlePinned: chat.titlePinned }, "Updated chat title pin status via API");
  res.json({ chat: toChatDetail(chat) });
});
