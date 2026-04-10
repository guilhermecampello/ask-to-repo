const questionEl = document.getElementById("question");
const repoSelectEl = document.getElementById("repoSelect");
const modelSelectEl = document.getElementById("modelSelect");
const askBtn = document.getElementById("askBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");

const HISTORY_KEY = "ask-to-repo:history:v1";
const SELECTED_REPO_KEY = "ask-to-repo:selected-repo:v1";
const SELECTED_MODEL_KEY = "ask-to-repo:selected-model:v1";
const MAX_MESSAGES = 200;

/** @type {{ id: string; role: "user" | "assistant"; repoFullName: string; model: string; content: string; createdAt: number }[]} */
let messages = [];
let isBusy = false;
let defaultModel = "raptor-mini";
let availableModels = ["raptor-mini"];

function renderAssistantMarkdown(text) {
  const raw = String(text || "");

  if (!window.marked || !window.DOMPurify) {
    const div = document.createElement("div");
    div.textContent = raw;
    return div.innerHTML;
  }

  marked.setOptions({ breaks: true, gfm: true });
  const html = marked.parse(raw);

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  });
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(epochMs) {
  const date = new Date(epochMs);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return;
    }
    messages = parsed.filter((item) => {
      return (
        item &&
        typeof item.id === "string" &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.repoFullName === "string" &&
        typeof item.content === "string" &&
        typeof item.createdAt === "number"
      );
    }).map((item) => ({
      ...item,
      model: typeof item.model === "string" && item.model.length > 0 ? item.model : "default",
    }));
  } catch {
    messages = [];
  }
}

function saveHistory() {
  const trimmed = messages.slice(-MAX_MESSAGES);
  messages = trimmed;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessages() {
  messagesEl.innerHTML = "";

  if (messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No messages yet. Ask your first question.";
    messagesEl.appendChild(empty);
    return;
  }

  for (const message of messages) {
    const wrapper = document.createElement("article");
    wrapper.className = `msg ${message.role}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${message.role === "user" ? "You" : "Assistant"} • ${message.repoFullName} • ${message.model} • ${formatTime(message.createdAt)}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (message.role === "assistant") {
      bubble.classList.add("markdown");
      const assistantContent = message.content || "Thinking...";
      bubble.innerHTML = renderAssistantMarkdown(assistantContent);
    } else {
      bubble.textContent = message.content;
    }

    wrapper.appendChild(meta);
    wrapper.appendChild(bubble);
    messagesEl.appendChild(wrapper);
  }

  scrollToBottom();
}

function appendMessage(role, repoFullName, model, content) {
  const message = {
    id: makeId(),
    role,
    repoFullName,
    model,
    content,
    createdAt: Date.now(),
  };
  messages.push(message);
  saveHistory();
  renderMessages();
  return message.id;
}

function updateMessageContent(id, content) {
  const msg = messages.find((item) => item.id === id);
  if (!msg) {
    return;
  }
  msg.content = content;
  saveHistory();
  renderMessages();
}

function setBusy(value) {
  isBusy = value;
  askBtn.disabled = value;
  repoSelectEl.disabled = value;
  modelSelectEl.disabled = value;
}

function setStatus(message) {
  statusEl.textContent = message;
}

async function loadRepos() {
  setStatus("Loading repositories...");
  const response = await fetch("/api/repos");

  if (!response.ok) {
    throw new Error(`Unable to load repositories (${response.status})`);
  }

  const payload = await response.json();
  const repos = Array.isArray(payload.repos) ? payload.repos : [];

  repoSelectEl.innerHTML = "";
  if (repos.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No accessible repositories found";
    repoSelectEl.appendChild(option);
    askBtn.disabled = true;
    setStatus("No repositories available for this token.");
    return;
  }

  for (const repo of repos) {
    const option = document.createElement("option");
    option.value = repo.fullName;
    option.textContent = `${repo.fullName}${repo.isPrivate ? " (private)" : ""}`;
    repoSelectEl.appendChild(option);
  }

  const savedRepo = localStorage.getItem(SELECTED_REPO_KEY);
  if (savedRepo && repos.some((repo) => repo.fullName === savedRepo)) {
    repoSelectEl.value = savedRepo;
  }

  askBtn.disabled = false;
  setStatus(`Loaded ${repos.length} repositories.`);
}

function renderModelOptions() {
  modelSelectEl.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = `Default (${defaultModel})`;
  modelSelectEl.appendChild(defaultOption);

  for (const model of availableModels) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelectEl.appendChild(option);
  }

  const savedModel = localStorage.getItem(SELECTED_MODEL_KEY);
  if (savedModel && availableModels.includes(savedModel)) {
    modelSelectEl.value = savedModel;
  } else {
    modelSelectEl.value = "";
  }
}

async function loadModels() {
  const response = await fetch("/api/models");
  if (!response.ok) {
    throw new Error(`Unable to load models (${response.status})`);
  }

  const payload = await response.json();
  defaultModel = typeof payload.defaultModel === "string" ? payload.defaultModel : "raptor-mini";
  availableModels = Array.isArray(payload.models)
    ? payload.models.filter((value) => typeof value === "string")
    : [defaultModel];

  if (!availableModels.includes(defaultModel)) {
    availableModels.unshift(defaultModel);
  }

  renderModelOptions();
}

async function askQuestion() {
  if (isBusy) {
    return;
  }

  const question = questionEl.value.trim();
  const repoFullName = String(repoSelectEl.value || "").trim();
  const selectedModel = String(modelSelectEl.value || "").trim();
  const effectiveModel = selectedModel || defaultModel;

  if (!repoFullName) {
    setStatus("Please select a repository.");
    return;
  }

  if (!question) {
    setStatus("Please enter a question.");
    return;
  }

  localStorage.setItem(SELECTED_REPO_KEY, repoFullName);
  localStorage.setItem(SELECTED_MODEL_KEY, selectedModel);

  setStatus("Submitting question...");
  setBusy(true);

  appendMessage("user", repoFullName, effectiveModel, question);
  const assistantMessageId = appendMessage("assistant", repoFullName, effectiveModel, "");
  questionEl.value = "";

  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, repoFullName, model: selectedModel || undefined }),
  });

  if (!response.ok || !response.body) {
    setStatus("Request failed.");
    const errText = await response.text();
    updateMessageContent(assistantMessageId, `[error] ${errText}`);
    setBusy(false);
    return;
  }

  setStatus("Streaming response...");

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      if (!part.startsWith("data: ")) {
        continue;
      }
      const payload = JSON.parse(part.slice(6));

      if (payload.type === "status") {
        setStatus(payload.message);
      }

      if (payload.type === "chunk") {
        const current = messages.find((item) => item.id === assistantMessageId)?.content || "";
        updateMessageContent(assistantMessageId, current + payload.content);
      }

      if (payload.type === "error") {
        setStatus("Error");
        const current = messages.find((item) => item.id === assistantMessageId)?.content || "";
        updateMessageContent(assistantMessageId, `${current}\n[error] ${payload.message}`.trim());
      }

      if (payload.type === "done") {
        setStatus(`Done (exit code ${payload.code}).`);
      }
    }
  }

  setBusy(false);
}

askBtn.addEventListener("click", () => {
  askQuestion().catch((error) => {
    setStatus("Unexpected error.");
    appendMessage(
      "assistant",
      String(repoSelectEl.value || "unknown"),
      String(modelSelectEl.value || defaultModel || "default"),
      `[error] ${String(error?.message || error)}`
    );
    setBusy(false);
  });
});

questionEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    askBtn.click();
  }
});

repoSelectEl.addEventListener("change", () => {
  localStorage.setItem(SELECTED_REPO_KEY, String(repoSelectEl.value || ""));
});

modelSelectEl.addEventListener("change", () => {
  localStorage.setItem(SELECTED_MODEL_KEY, String(modelSelectEl.value || ""));
});

clearBtn.addEventListener("click", () => {
  messages = [];
  saveHistory();
  renderMessages();
  setStatus("History cleared.");
});

loadHistory();
renderMessages();

loadModels().catch((error) => {
  appendMessage("assistant", "system", "system", `[error] ${String(error?.message || error)}`);
});

loadRepos().catch((error) => {
  askBtn.disabled = true;
  setStatus("Failed to load repositories.");
  appendMessage("assistant", "system", "system", `[error] ${String(error?.message || error)}`);
});
