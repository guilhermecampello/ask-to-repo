import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config";
import { logger } from "../logger";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string;
  createdAt: number;
};

export type ChatRecord = {
  id: string;
  repoFullName: string;
  title: string;
  titlePinned: boolean;
  model: string;
  copilotSessionId: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

type StoreData = {
  chats: ChatRecord[];
};

const INITIAL_STORE: StoreData = { chats: [] };

let writeQueue: Promise<void> = Promise.resolve();

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function tokenize(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);

  return new Set(tokens);
}

function titleSimilarity(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (aTokens.size === 0 && bTokens.size === 0) {
    return 1;
  }

  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 1 : intersection / union;
}

async function ensureStoreDir(): Promise<void> {
  await mkdir(path.dirname(config.SESSIONS_FILE_PATH), { recursive: true });
}

async function readStore(): Promise<StoreData> {
  await ensureStoreDir();

  try {
    const raw = await readFile(config.SESSIONS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreData>;

    if (!parsed || !Array.isArray(parsed.chats)) {
      return INITIAL_STORE;
    }

    const chats: ChatRecord[] = parsed.chats
      .filter((chat) => {
        return (
          !!chat &&
          typeof chat.id === "string" &&
          typeof chat.repoFullName === "string" &&
          typeof chat.title === "string" &&
          typeof chat.model === "string" &&
          (chat.copilotSessionId === null || typeof chat.copilotSessionId === "string") &&
          typeof chat.createdAt === "number" &&
          typeof chat.updatedAt === "number" &&
          Array.isArray(chat.messages)
        );
      })
      .map((chat) => ({
        id: chat!.id as string,
        repoFullName: chat!.repoFullName as string,
        title: chat!.title as string,
        titlePinned: !!chat!.titlePinned,
        model: chat!.model as string,
        copilotSessionId: (chat!.copilotSessionId as string | null) ?? null,
        createdAt: chat!.createdAt as number,
        updatedAt: chat!.updatedAt as number,
        messages: chat!.messages as ChatMessage[],
      }));

    logger.debug({ chatCount: chats.length, sessionsFilePath: config.SESSIONS_FILE_PATH }, "Loaded chat store from disk");
    return { chats };
  } catch {
    logger.debug({ sessionsFilePath: config.SESSIONS_FILE_PATH }, "Chat store missing or unreadable, using empty store");
    return INITIAL_STORE;
  }
}

async function writeStore(data: StoreData): Promise<void> {
  await ensureStoreDir();
  const tempPath = `${config.SESSIONS_FILE_PATH}.tmp`;
  await writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tempPath, config.SESSIONS_FILE_PATH);
  logger.debug({ chatCount: data.chats.length, sessionsFilePath: config.SESSIONS_FILE_PATH }, "Persisted chat store to disk");
}

async function withStoreMutation<T>(mutate: (store: StoreData) => T): Promise<T> {
  const operation = writeQueue.catch(() => undefined).then(async () => {
    const store = await readStore();
    const result = mutate(store);
    await writeStore(store);
    return result;
  });

  writeQueue = operation.then(() => undefined, () => undefined);
  return await operation;
}

export async function listChatsByRepo(repoFullName?: string): Promise<ChatRecord[]> {
  const store = await readStore();
  const filtered = repoFullName
    ? store.chats.filter((chat) => chat.repoFullName === repoFullName)
    : store.chats;

  logger.debug({ repoFullName: repoFullName || null, returnedCount: filtered.length }, "Listed chats from store");

  return filtered.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChatById(chatId: string): Promise<ChatRecord | null> {
  const store = await readStore();
  const chat = store.chats.find((item) => item.id === chatId) ?? null;
  logger.debug({ chatId, found: !!chat }, "Looked up chat by ID");
  return chat;
}

export async function createChat(input: {
  repoFullName: string;
  model: string;
  title?: string;
  copilotSessionId?: string | null;
}): Promise<ChatRecord> {
  const now = Date.now();

  return await withStoreMutation((store) => {
    const chat: ChatRecord = {
      id: randomUUID(),
      repoFullName: input.repoFullName,
      title: (input.title || "New chat").trim() || "New chat",
      titlePinned: false,
      model: input.model,
      copilotSessionId: input.copilotSessionId?.trim() || randomUUID(),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    store.chats.push(chat);
    logger.info(
      {
        chatId: chat.id,
        repoFullName: chat.repoFullName,
        model: chat.model,
        hasCopilotSessionId: !!chat.copilotSessionId,
      },
      "Created chat record"
    );
    return chat;
  });
}

export async function appendChatMessage(input: {
  chatId: string;
  role: "user" | "assistant";
  content: string;
  model: string;
}): Promise<ChatRecord | null> {
  const now = Date.now();

  return await withStoreMutation((store) => {
    const chat = store.chats.find((item) => item.id === input.chatId);
    if (!chat) {
      logger.warn({ chatId: input.chatId, role: input.role }, "Attempted to append message to missing chat");
      return null;
    }

    chat.messages.push({
      id: randomUUID(),
      role: input.role,
      content: input.content,
      model: input.model,
      createdAt: now,
    });
    chat.updatedAt = now;
    chat.model = input.model;
    logger.debug(
      {
        chatId: chat.id,
        role: input.role,
        model: input.model,
        contentLength: input.content.length,
        messageCount: chat.messages.length,
      },
      "Appended chat message"
    );

    return chat;
  });
}

export async function updateChatSessionId(chatId: string, copilotSessionId: string): Promise<ChatRecord | null> {
  const normalized = copilotSessionId.trim();
  if (!normalized) {
    return getChatById(chatId);
  }

  return await withStoreMutation((store) => {
    const chat = store.chats.find((item) => item.id === chatId);
    if (!chat) {
      logger.warn({ chatId }, "Attempted to update Copilot session ID for missing chat");
      return null;
    }

    chat.copilotSessionId = normalized;
    chat.updatedAt = Date.now();
    logger.info({ chatId, copilotSessionId: normalized }, "Updated chat Copilot session ID");
    return chat;
  });
}

export async function ensureChatSessionId(chatId: string): Promise<ChatRecord | null> {
  return await withStoreMutation((store) => {
    const chat = store.chats.find((item) => item.id === chatId);
    if (!chat) {
      logger.warn({ chatId }, "Attempted to ensure Copilot session ID for missing chat");
      return null;
    }

    if (!chat.copilotSessionId || !chat.copilotSessionId.trim()) {
      chat.copilotSessionId = randomUUID();
      chat.updatedAt = Date.now();
      logger.info({ chatId, copilotSessionId: chat.copilotSessionId }, "Assigned new Copilot session ID to chat");
    } else {
      logger.debug({ chatId, copilotSessionId: chat.copilotSessionId }, "Chat already had Copilot session ID");
    }

    return chat;
  });
}

export async function updateChatTitleIfNeeded(chatId: string, proposedTitle: string): Promise<ChatRecord | null> {
  const normalized = normalizeTitle(proposedTitle);
  if (!normalized) {
    return getChatById(chatId);
  }

  const shortened = normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}...` : normalized;

  return await withStoreMutation((store) => {
    const chat = store.chats.find((item) => item.id === chatId);
    if (!chat) {
      logger.warn({ chatId }, "Attempted to update title for missing chat");
      return null;
    }

    if (chat.titlePinned) {
      logger.debug({ chatId, title: chat.title }, "Skipped auto title update because title is pinned");
      return chat;
    }

    const current = normalizeTitle(chat.title);
    const same = current.toLowerCase() === shortened.toLowerCase();
    if (same) {
      logger.debug({ chatId, title: current }, "Chat title unchanged (same title)");
      return chat;
    }

    const similarity = titleSimilarity(current, shortened);
    const isAutoTitle = current === "New chat" || /^chat\s\d{1,2}\/\d{1,2}\/\d{4}/i.test(current);

    if (!isAutoTitle && similarity >= 0.6) {
      logger.debug(
        { chatId, currentTitle: current, proposedTitle: shortened, similarity },
        "Chat title unchanged (not materially different)"
      );
      return chat;
    }

    chat.title = shortened;
    chat.updatedAt = Date.now();
    logger.info({ chatId, previousTitle: current, newTitle: shortened, similarity }, "Updated chat title");
    return chat;
  });
}

export async function setChatTitlePinned(chatId: string, pinned: boolean): Promise<ChatRecord | null> {
  return await withStoreMutation((store) => {
    const chat = store.chats.find((item) => item.id === chatId);
    if (!chat) {
      logger.warn({ chatId, pinned }, "Attempted to set title pin on missing chat");
      return null;
    }

    chat.titlePinned = pinned;
    chat.updatedAt = Date.now();
    logger.info({ chatId, titlePinned: pinned, title: chat.title }, "Updated chat title pin status");
    return chat;
  });
}
