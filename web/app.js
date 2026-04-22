const questionEl = document.getElementById("question");
const repoSelectEl = document.getElementById("repoSelect");
const repoSearchInputEl = document.getElementById("repoSearchInput");
const activeRepoListEl = document.getElementById("activeRepoList");
const otherRepoListEl = document.getElementById("otherRepoList");
const modelSelectEl = document.getElementById("modelSelect");
const askBtn = document.getElementById("askBtn");
const newChatBtn = document.getElementById("newChatBtn");
const pinTitleBtn = document.getElementById("pinTitleBtn");
const refreshPullsBtn = document.getElementById("refreshPullsBtn");
const refreshClosedPullsBtn = document.getElementById("refreshClosedPullsBtn");
const closedPullSearchInputEl = document.getElementById("closedPullSearchInput");
const closedPullPrevBtn = document.getElementById("closedPullPrevBtn");
const closedPullNextBtn = document.getElementById("closedPullNextBtn");
const closedPullPageInfoEl = document.getElementById("closedPullPageInfo");
const refreshArtifactsBtn = document.getElementById("refreshArtifactsBtn");
const artifactRunFilterEl = document.getElementById("artifactRunFilter");
const artifactExpiredFilterEl = document.getElementById("artifactExpiredFilter");
const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");
const chatListEl = document.getElementById("chatList");
const pullsListEl = document.getElementById("pullsList");
const closedPullsListEl = document.getElementById("closedPullsList");
const artifactsListEl = document.getElementById("artifactsList");
const prDrawerBackdropEl = document.getElementById("prDrawerBackdrop");
const closePrDrawerBtn = document.getElementById("closePrDrawerBtn");
const prDrawerTitleEl = document.getElementById("prDrawerTitle");
const prDrawerMetaEl = document.getElementById("prDrawerMeta");
const prDrawerBodyEl = document.getElementById("prDrawerBody");
const diffDialogBackdropEl = document.getElementById("diffDialogBackdrop");
const closeDiffDialogBtn = document.getElementById("closeDiffDialogBtn");
const diffDialogTitleEl = document.getElementById("diffDialogTitle");
const diffDialogMetaEl = document.getElementById("diffDialogMeta");
const diffDialogContentEl = document.getElementById("diffDialogContent");

const SELECTED_REPO_KEY = "ask-to-repo:selected-repo:v1";
const SELECTED_MODEL_KEY = "ask-to-repo:selected-model:v1";
const ACTIVE_CHAT_BY_REPO_KEY = "ask-to-repo:active-chat-by-repo:v1";

/** @type {{ id: string; repoFullName: string; title: string; titlePinned: boolean; model: string; copilotSessionId: string | null; createdAt: number; updatedAt: number; messageCount: number }[]} */
let chats = [];
/** @type {{ id: string; role: "user" | "assistant"; content: string; model: string; createdAt: number }[]} */
let messages = [];
let activeChatId = "";
let isBusy = false;
let defaultModel = "gpt-5-mini";
let availableModels = ["gpt-5-mini"];
let repos = [];
let repoSearchTerm = "";
let activePullRequests = [];
let closedPullRequests = [];
let closedPullSearchTerm = "";
let closedPullPage = 1;
let closedPullsHasNextPage = false;
let closedPullRepoFullName = "";
const CLOSED_PULLS_PER_PAGE = 10;
let allArtifacts = [];
let activeArtifacts = [];
let selectedArtifactRunFilter = "";
let includeExpiredArtifacts = false;

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

function renderSafeMarkdown(text) {
  const raw = String(text || "");

  if (!window.marked || !window.DOMPurify) {
    const div = document.createElement("div");
    div.textContent = raw;
    return div.innerHTML;
  }

  marked.setOptions({ breaks: true, gfm: true });
  const html = marked.parse(raw);
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(epochMs) {
  const date = new Date(epochMs);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(epochMs) {
  const date = new Date(epochMs);
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getActiveChatMap() {
  try {
    const raw = localStorage.getItem(ACTIVE_CHAT_BY_REPO_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setActiveChatForRepo(repoFullName, chatId) {
  const map = getActiveChatMap();
  map[repoFullName] = chatId;
  localStorage.setItem(ACTIVE_CHAT_BY_REPO_KEY, JSON.stringify(map));
}

function renderRepoGroup(targetEl, groupRepos, emptyMessage) {
  targetEl.innerHTML = "";

  if (groupRepos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyMessage;
    targetEl.appendChild(empty);
    return;
  }

  for (const repo of groupRepos) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `repo-item${repo.fullName === String(repoSelectEl.value || "") ? " active" : ""}`;

    const title = document.createElement("div");
    title.className = "repo-title";
    title.textContent = repo.fullName;

    const meta = document.createElement("div");
    meta.className = "repo-meta";
    meta.textContent = `${repo.isPrivate ? "private" : "public"} • ${repo.defaultBranch}`;

    button.appendChild(title);
    button.appendChild(meta);
    button.addEventListener("click", () => {
      if (repoSelectEl.value === repo.fullName) {
        return;
      }

      repoSelectEl.value = repo.fullName;
      localStorage.setItem(SELECTED_REPO_KEY, repo.fullName);
      renderRepoPanel();
      Promise.all([loadChatsForSelectedRepo(), loadGitHubIntegrationsForSelectedRepo()]).catch((error) => {
        setStatus(`Failed to load repository data: ${String(error?.message || error)}`);
      });
    });

    targetEl.appendChild(button);
  }
}

function renderRepoPanel() {
  const term = repoSearchTerm.trim().toLowerCase();
  const filtered = repos.filter((repo) => {
    if (!term) {
      return true;
    }

    return repo.fullName.toLowerCase().includes(term) || repo.name.toLowerCase().includes(term);
  });

  const active = filtered.filter((repo) => !!repo.isCloned);
  const other = filtered.filter((repo) => !repo.isCloned);

  renderRepoGroup(activeRepoListEl, active, "No cloned repositories found.");
  renderRepoGroup(otherRepoListEl, other, "No other repositories found.");
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed (${response.status})`);
  }
  return response.json();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessages() {
  messagesEl.innerHTML = "";

  if (messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = activeChatId
      ? "No messages yet. Ask your first question."
      : "Create or select a chat to start.";
    messagesEl.appendChild(empty);
    return;
  }

  const repoFullName = String(repoSelectEl.value || "").trim();
  for (const message of messages) {
    const wrapper = document.createElement("article");
    wrapper.className = `msg ${message.role}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${message.role === "user" ? "You" : "Assistant"} • ${repoFullName || "repo"} • ${message.model || "default"} • ${formatTime(message.createdAt)}`;

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

function renderChatList() {
  chatListEl.innerHTML = "";

  if (chats.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No chats for this repository.";
    chatListEl.appendChild(empty);
    return;
  }

  for (const chat of chats) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-item${chat.id === activeChatId ? " active" : ""}`;

    const title = document.createElement("div");
    title.className = "chat-title";
    title.textContent = chat.title;

    const meta = document.createElement("div");
    const sessionLabel = chat.copilotSessionId ? "linked" : "new";
    const pinLabel = chat.titlePinned ? "pinned" : "auto";
    meta.className = "chat-meta";
    meta.textContent = `${chat.messageCount} msgs • ${sessionLabel} • ${pinLabel} • ${formatDateTime(chat.updatedAt)}`;

    button.appendChild(title);
    button.appendChild(meta);
    button.addEventListener("click", () => {
      selectChat(chat.id).catch((error) => {
        setStatus(`Failed to open chat: ${String(error?.message || error)}`);
      });
    });

    chatListEl.appendChild(button);
  }
}

function getActiveChatSummary() {
  if (!activeChatId) {
    return null;
  }

  return chats.find((chat) => chat.id === activeChatId) || null;
}

function refreshPinTitleButton() {
  const active = getActiveChatSummary();
  pinTitleBtn.disabled = isBusy || !active;
  pinTitleBtn.textContent = active?.titlePinned ? "Unpin title" : "Pin title";
}

function setBusy(value) {
  isBusy = value;
  askBtn.disabled = value;
  repoSelectEl.disabled = value;
  modelSelectEl.disabled = value;
  newChatBtn.disabled = value;
  refreshPinTitleButton();
}

function setStatus(message) {
  statusEl.textContent = message;
}

function formatIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return "-";
  }

  if (num < 1024) {
    return `${num} B`;
  }
  if (num < 1024 * 1024) {
    return `${(num / 1024).toFixed(1)} KB`;
  }
  if (num < 1024 * 1024 * 1024) {
    return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(num / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function renderPullRequests() {
  pullsListEl.innerHTML = "";

  if (activePullRequests.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No open pull requests.";
    pullsListEl.appendChild(empty);
    return;
  }

  for (const pr of activePullRequests) {
    const item = document.createElement("div");
    item.className = "integration-item pr-clickable";

    const link = document.createElement("a");
    link.href = pr.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `#${pr.number} ${pr.title}`;

    const meta = document.createElement("div");
    meta.className = "integration-meta";
    meta.textContent = `${pr.draft ? "draft" : pr.state} • ${pr.author} • ${formatIsoDate(pr.updatedAt)}`;

    item.appendChild(link);
    item.appendChild(meta);
    item.addEventListener("click", (event) => {
      if (event.target instanceof HTMLAnchorElement) {
        return;
      }

      openPullRequestDrawer(pr.number).catch((error) => {
        setStatus(`Failed to load pull request details: ${String(error?.message || error)}`);
      });
    });
    pullsListEl.appendChild(item);
  }
}

function renderClosedPullRequests() {
  closedPullsListEl.innerHTML = "";

  const updateClosedPullPaginationControls = () => {
    closedPullPageInfoEl.textContent = `Page ${closedPullPage}`;
    closedPullPrevBtn.disabled = closedPullPage <= 1;
    closedPullNextBtn.disabled = !closedPullsHasNextPage;
  };

  const term = closedPullSearchTerm.trim().toLowerCase();
  const filtered = closedPullRequests.filter((pr) => {
    if (!term) {
      return true;
    }

    return (
      String(pr.number).includes(term) ||
      pr.title.toLowerCase().includes(term) ||
      pr.author.toLowerCase().includes(term)
    );
  });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = term ? "No closed pull requests match your search." : "No closed pull requests.";
    closedPullsListEl.appendChild(empty);
    updateClosedPullPaginationControls();
    return;
  }

  for (const pr of filtered) {
    const item = document.createElement("div");
    item.className = "integration-item pr-clickable";

    const link = document.createElement("a");
    link.href = pr.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `#${pr.number} ${pr.title}`;

    const meta = document.createElement("div");
    meta.className = "integration-meta";
    const chip = document.createElement("span");
    const statusValue = pr.closeStatus === "merged" ? "merged" : "closed";
    chip.className = `status-chip ${statusValue}`;
    chip.textContent = statusValue;

    const metaText = document.createElement("span");
    metaText.textContent = `${pr.author} • ${formatIsoDate(pr.updatedAt)}`;

    meta.appendChild(chip);
    meta.appendChild(metaText);

    item.appendChild(link);
    item.appendChild(meta);
    item.addEventListener("click", (event) => {
      if (event.target instanceof HTMLAnchorElement) {
        return;
      }

      openPullRequestDrawer(pr.number).catch((error) => {
        setStatus(`Failed to load pull request details: ${String(error?.message || error)}`);
      });
    });

    closedPullsListEl.appendChild(item);
  }

  updateClosedPullPaginationControls();
}

function renderArtifactRunOptions() {
  const runIds = [...new Set(allArtifacts.map((artifact) => artifact.workflowRunId).filter((value) => value != null))];
  runIds.sort((a, b) => Number(b) - Number(a));

  artifactRunFilterEl.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All runs";
  artifactRunFilterEl.appendChild(allOption);

  for (const runId of runIds) {
    const option = document.createElement("option");
    option.value = String(runId);
    option.textContent = `Run ${runId}`;
    artifactRunFilterEl.appendChild(option);
  }

  if (selectedArtifactRunFilter && runIds.some((runId) => String(runId) === selectedArtifactRunFilter)) {
    artifactRunFilterEl.value = selectedArtifactRunFilter;
  } else {
    selectedArtifactRunFilter = "";
    artifactRunFilterEl.value = "";
  }
}

function applyArtifactFilters() {
  activeArtifacts = allArtifacts.filter((artifact) => {
    if (!includeExpiredArtifacts && artifact.expired) {
      return false;
    }

    if (selectedArtifactRunFilter && String(artifact.workflowRunId || "") !== selectedArtifactRunFilter) {
      return false;
    }

    return true;
  });
}

function renderArtifacts() {
  artifactsListEl.innerHTML = "";

  if (activeArtifacts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No artifacts available.";
    artifactsListEl.appendChild(empty);
    return;
  }

  for (const artifact of activeArtifacts) {
    const item = document.createElement("div");
    item.className = "integration-item";

    const link = document.createElement("a");
    link.href = artifact.downloadPath || artifact.archiveDownloadUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = artifact.name;

    const meta = document.createElement("div");
    meta.className = "integration-meta";
    const runPart = artifact.workflowRunUrl ? ` • run ${artifact.workflowRunId}` : "";
    meta.textContent = `${artifact.expired ? "expired" : "active"} • ${formatBytes(artifact.sizeInBytes)} • exp ${formatIsoDate(artifact.expiresAt)}${runPart}`;

    if (artifact.workflowRunUrl) {
      const runLink = document.createElement("a");
      runLink.href = artifact.workflowRunUrl;
      runLink.target = "_blank";
      runLink.rel = "noreferrer";
      runLink.textContent = "View run";
      runLink.style.marginLeft = "8px";
      meta.appendChild(document.createTextNode(" "));
      meta.appendChild(runLink);
    }

    item.appendChild(link);
    item.appendChild(meta);
    artifactsListEl.appendChild(item);
  }
}

function closePullRequestDrawer() {
  prDrawerBackdropEl.classList.remove("open");
  prDrawerBackdropEl.setAttribute("aria-hidden", "true");
}

function closeDiffDialog() {
  diffDialogBackdropEl.classList.remove("open");
  diffDialogBackdropEl.setAttribute("aria-hidden", "true");
}

function renderDiffPatch(patch) {
  diffDialogContentEl.innerHTML = "";
  const text = String(patch || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  for (const line of lines) {
    const row = document.createElement("div");
    if (line.startsWith("+")) {
      row.className = "diff-line add";
    } else if (line.startsWith("-")) {
      row.className = "diff-line remove";
    } else if (line.startsWith("@@") || line.startsWith("diff --git") || line.startsWith("index ")) {
      row.className = "diff-line meta";
    }
    row.textContent = line;
    diffDialogContentEl.appendChild(row);
  }
}

function openFileDiffDialog(file) {
  diffDialogTitleEl.textContent = `Diff: ${file.filename}`;
  diffDialogMetaEl.textContent = `${file.status} • +${file.additions} / -${file.deletions} • ${file.changes} changes`;

  if (file.patch) {
    renderDiffPatch(file.patch);
  } else {
    diffDialogContentEl.textContent = "No textual patch available for this file (binary, too large, or unavailable from GitHub API).";
  }

  diffDialogBackdropEl.classList.add("open");
  diffDialogBackdropEl.setAttribute("aria-hidden", "false");
}

function renderPullRequestDrawer(detail) {
  prDrawerTitleEl.textContent = `PR #${detail.number} ${detail.title}`;
  prDrawerMetaEl.textContent = `${detail.draft ? "draft" : detail.state} • ${detail.author} • ${detail.baseBranch} <- ${detail.headBranch} • updated ${formatIsoDate(detail.updatedAt)}`;

  prDrawerBodyEl.innerHTML = "";

  const summary = document.createElement("section");
  summary.className = "drawer-section";
  const summaryTitle = document.createElement("h4");
  summaryTitle.textContent = "Summary";

  const summaryBody = document.createElement("div");
  summaryBody.className = "drawer-markdown";
  summaryBody.innerHTML = renderSafeMarkdown(detail.body || "No description.");

  const summaryStats = document.createElement("div");
  summaryStats.className = "small-muted";
  summaryStats.textContent = `Files: ${detail.changedFiles} • +${detail.additions} / -${detail.deletions} • Commits: ${detail.commits}`;

  const summaryMergeable = document.createElement("div");
  summaryMergeable.className = "small-muted";
  summaryMergeable.textContent = `Mergeable: ${detail.mergeable === null ? "unknown" : detail.mergeable ? "yes" : "no"}`;

  const summaryLinkWrap = document.createElement("div");
  summaryLinkWrap.className = "small-muted";
  const summaryLink = document.createElement("a");
  summaryLink.href = detail.url;
  summaryLink.target = "_blank";
  summaryLink.rel = "noreferrer";
  summaryLink.textContent = "Open on GitHub";
  summaryLinkWrap.appendChild(summaryLink);

  summary.appendChild(summaryTitle);
  summary.appendChild(summaryBody);
  summary.appendChild(summaryStats);
  summary.appendChild(summaryMergeable);
  summary.appendChild(summaryLinkWrap);

  const checks = document.createElement("section");
  checks.className = "drawer-section";
  checks.innerHTML = `<h4>Checks (${detail.checks.length})</h4>`;
  if (detail.checks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "small-muted";
    empty.textContent = "No checks found for this head commit.";
    checks.appendChild(empty);
  } else {
    for (const check of detail.checks) {
      const item = document.createElement("div");
      item.className = "pr-check-item";
      const title = document.createElement("div");
      title.textContent = check.name;
      const meta = document.createElement("div");
      meta.className = "small-muted";
      meta.textContent = `${check.status} • ${check.conclusion || "pending"}`;
      item.appendChild(title);
      item.appendChild(meta);
      if (check.detailsUrl) {
        const link = document.createElement("a");
        link.href = check.detailsUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "View details";
        item.appendChild(link);
      }
      checks.appendChild(item);
    }
  }

  const files = document.createElement("section");
  files.className = "drawer-section";
  files.innerHTML = `<h4>Changed Files (${detail.files.length})</h4>`;
  if (detail.files.length === 0) {
    const empty = document.createElement("div");
    empty.className = "small-muted";
    empty.textContent = "No file changes returned by API.";
    files.appendChild(empty);
  } else {
    for (const file of detail.files) {
      const item = document.createElement("div");
      item.className = "pr-file-item";
      const name = document.createElement("div");
      name.textContent = file.filename;
      const meta = document.createElement("div");
      meta.className = "small-muted";
      meta.textContent = `${file.status} • +${file.additions} / -${file.deletions} • ${file.changes} changes`;
      item.appendChild(name);
      item.appendChild(meta);
      item.addEventListener("click", () => {
        openFileDiffDialog(file);
      });
      files.appendChild(item);
    }
  }

  prDrawerBodyEl.appendChild(summary);
  prDrawerBodyEl.appendChild(checks);
  prDrawerBodyEl.appendChild(files);
}

async function openPullRequestDrawer(pullNumber) {
  const repoFullName = String(repoSelectEl.value || "").trim();
  if (!repoFullName) {
    setStatus("Select a repository first.");
    return;
  }

  prDrawerTitleEl.textContent = `Pull Request #${pullNumber}`;
  prDrawerMetaEl.textContent = "Loading details...";
  prDrawerBodyEl.innerHTML = "";
  prDrawerBackdropEl.classList.add("open");
  prDrawerBackdropEl.setAttribute("aria-hidden", "false");

  const payload = await apiJson(
    `/api/github/pulls/${pullNumber}?repoFullName=${encodeURIComponent(repoFullName)}`
  );
  const detail = payload?.pullRequest;
  if (!detail || detail.number !== pullNumber) {
    throw new Error("Invalid pull request detail payload.");
  }

  renderPullRequestDrawer(detail);
}

async function loadPullRequestsForSelectedRepo() {
  const repoFullName = String(repoSelectEl.value || "").trim();
  if (!repoFullName) {
    activePullRequests = [];
    renderPullRequests();
    return;
  }

  const payload = await apiJson(`/api/github/pulls?repoFullName=${encodeURIComponent(repoFullName)}&state=open`);
  activePullRequests = Array.isArray(payload.pullRequests) ? payload.pullRequests : [];
  renderPullRequests();
}

async function loadClosedPullRequestsForSelectedRepo() {
  const repoFullName = String(repoSelectEl.value || "").trim();
  if (!repoFullName) {
    closedPullRequests = [];
    closedPullPage = 1;
    closedPullsHasNextPage = false;
    closedPullRepoFullName = "";
    renderClosedPullRequests();
    return;
  }

  if (closedPullRepoFullName !== repoFullName) {
    closedPullRepoFullName = repoFullName;
    closedPullPage = 1;
  }

  const normalizedPage = Math.max(1, Number(closedPullPage || 1));

  const payload = await apiJson(
    `/api/github/pulls?repoFullName=${encodeURIComponent(repoFullName)}&state=closed&page=${normalizedPage}&perPage=${CLOSED_PULLS_PER_PAGE}`
  );
  closedPullRequests = Array.isArray(payload.pullRequests) ? payload.pullRequests : [];
  closedPullPage = Number.isFinite(Number(payload.page)) ? Number(payload.page) : normalizedPage;
  closedPullsHasNextPage = !!payload.hasNextPage;
  renderClosedPullRequests();
}

async function goToClosedPullPage(nextPage) {
  const targetPage = Math.max(1, Number(nextPage || 1));
  closedPullPage = targetPage;
  await loadClosedPullRequestsForSelectedRepo();
}

async function loadArtifactsForSelectedRepo() {
  const repoFullName = String(repoSelectEl.value || "").trim();
  if (!repoFullName) {
    allArtifacts = [];
    activeArtifacts = [];
    renderArtifactRunOptions();
    renderArtifacts();
    return;
  }

  const payload = await apiJson(`/api/github/artifacts?repoFullName=${encodeURIComponent(repoFullName)}`);
  allArtifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  renderArtifactRunOptions();
  applyArtifactFilters();
  renderArtifacts();
}

async function loadGitHubIntegrationsForSelectedRepo() {
  await Promise.all([
    loadPullRequestsForSelectedRepo(),
    loadClosedPullRequestsForSelectedRepo(),
    loadArtifactsForSelectedRepo(),
  ]);
}

async function loadRepos() {
  setStatus("Loading repositories...");
  const payload = await apiJson("/api/repos");
  repos = Array.isArray(payload.repos) ? payload.repos : [];

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

  if (!repoSelectEl.value && repos[0]?.fullName) {
    repoSelectEl.value = repos[0].fullName;
  }

  renderRepoPanel();

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
  const payload = await apiJson("/api/models");
  defaultModel = typeof payload.defaultModel === "string" ? payload.defaultModel : "gpt-5-mini";
  availableModels = Array.isArray(payload.models)
    ? payload.models.filter((value) => typeof value === "string")
    : [defaultModel];

  if (!availableModels.includes(defaultModel)) {
    availableModels.unshift(defaultModel);
  }

  renderModelOptions();
}

async function loadChatsForSelectedRepo() {
  const repoFullName = String(repoSelectEl.value || "").trim();
  if (!repoFullName) {
    chats = [];
    activeChatId = "";
    messages = [];
    renderChatList();
    renderMessages();
    return;
  }

  const payload = await apiJson(`/api/chats?repoFullName=${encodeURIComponent(repoFullName)}`);
  chats = Array.isArray(payload.chats) ? payload.chats : [];

  const map = getActiveChatMap();
  const mappedChatId = typeof map[repoFullName] === "string" ? map[repoFullName] : "";
  const fallbackChatId = chats[0]?.id || "";
  activeChatId = chats.some((chat) => chat.id === mappedChatId) ? mappedChatId : fallbackChatId;

  renderChatList();

  if (activeChatId) {
    await selectChat(activeChatId);
  } else {
    messages = [];
    renderMessages();
    setStatus("Create a chat to begin.");
    refreshPinTitleButton();
  }
}

async function createAndSelectChat() {
  const repoFullName = String(repoSelectEl.value || "").trim();
  const selectedModel = String(modelSelectEl.value || "").trim();
  const model = selectedModel || defaultModel;

  if (!repoFullName) {
    setStatus("Select a repository first.");
    return;
  }

  setStatus("Creating chat...");
  const payload = await apiJson("/api/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoFullName, model }),
  });

  const chat = payload?.chat;
  if (!chat?.id) {
    throw new Error("Chat creation returned an invalid payload.");
  }

  await loadChatsForSelectedRepo();
  await selectChat(chat.id);
  setStatus("New chat ready.");
}

async function selectChat(chatId) {
  if (!chatId) {
    return;
  }

  const payload = await apiJson(`/api/chats/${encodeURIComponent(chatId)}`);
  const chat = payload?.chat;
  if (!chat || chat.id !== chatId) {
    throw new Error("Unable to load selected chat.");
  }

  const existing = chats.findIndex((item) => item.id === chat.id);
  const summaryFromDetail = {
    id: chat.id,
    repoFullName: chat.repoFullName,
    title: chat.title,
    titlePinned: !!chat.titlePinned,
    model: chat.model,
    copilotSessionId: chat.copilotSessionId,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
  };
  if (existing >= 0) {
    chats[existing] = summaryFromDetail;
  } else {
    chats.unshift(summaryFromDetail);
  }

  activeChatId = chatId;
  messages = Array.isArray(chat.messages) ? chat.messages : [];
  setActiveChatForRepo(chat.repoFullName, chat.id);
  renderChatList();
  renderMessages();
  refreshPinTitleButton();

  if (chat.copilotSessionId) {
    setStatus(`Chat ready (Copilot session: ${chat.copilotSessionId}).`);
  } else {
    setStatus("Chat ready.");
  }
}

async function toggleTitlePin() {
  const active = getActiveChatSummary();
  if (!active) {
    setStatus("Select a chat first.");
    return;
  }

  const targetPinned = !active.titlePinned;
  setStatus(targetPinned ? "Pinning title..." : "Unpinning title...");

  const payload = await apiJson(`/api/chats/${encodeURIComponent(active.id)}/title-pin`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned: targetPinned }),
  });

  const updated = payload?.chat;
  if (!updated || updated.id !== active.id) {
    throw new Error("Title pin update returned an invalid payload.");
  }

  await loadChatsForSelectedRepo();
  await selectChat(updated.id);
  setStatus(updated.titlePinned ? "Title pinned." : "Title unpinned.");
}

function appendLocalMessage(role, content, model) {
  const message = {
    id: makeId(),
    role,
    content,
    model,
    createdAt: Date.now(),
  };
  messages.push(message);
  renderMessages();
  return message.id;
}

function updateLocalMessageContent(id, content) {
  const msg = messages.find((item) => item.id === id);
  if (!msg) {
    return;
  }
  msg.content = content;
  renderMessages();
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

  if (!activeChatId) {
    await createAndSelectChat();
  }

  if (!question) {
    setStatus("Please enter a question.");
    return;
  }

  localStorage.setItem(SELECTED_REPO_KEY, repoFullName);
  localStorage.setItem(SELECTED_MODEL_KEY, selectedModel);

  setStatus("Submitting question...");
  setBusy(true);

  appendLocalMessage("user", question, effectiveModel);
  const assistantMessageId = appendLocalMessage("assistant", "", effectiveModel);
  questionEl.value = "";

  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      repoFullName,
      model: selectedModel || undefined,
      chatId: activeChatId,
    }),
  });

  if (!response.ok || !response.body) {
    setStatus("Request failed.");
    const errText = await response.text();
    updateLocalMessageContent(assistantMessageId, `[error] ${errText}`);
    setBusy(false);
    await loadChatsForSelectedRepo();
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
        updateLocalMessageContent(assistantMessageId, current + payload.content);
      }

      if (payload.type === "error") {
        setStatus("Error");
        const current = messages.find((item) => item.id === assistantMessageId)?.content || "";
        updateLocalMessageContent(assistantMessageId, `${current}\n[error] ${payload.message}`.trim());
      }

      if (payload.type === "done") {
        const resumeInfo = payload.copilotSessionId ? ` Session: ${payload.copilotSessionId}.` : "";
        setStatus(`Done (exit code ${payload.code}).${resumeInfo}`);
      }
    }
  }

  setBusy(false);
  await loadChatsForSelectedRepo();
  if (activeChatId) {
    await selectChat(activeChatId);
  }
}

askBtn.addEventListener("click", () => {
  askQuestion().catch((error) => {
    setStatus(`Unexpected error: ${String(error?.message || error)}`);
    setBusy(false);
  });
});

newChatBtn.addEventListener("click", () => {
  createAndSelectChat().catch((error) => {
    setStatus(`Failed to create chat: ${String(error?.message || error)}`);
  });
});

pinTitleBtn.addEventListener("click", () => {
  toggleTitlePin().catch((error) => {
    setStatus(`Failed to update title pin: ${String(error?.message || error)}`);
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
  renderRepoPanel();
  Promise.all([loadChatsForSelectedRepo(), loadGitHubIntegrationsForSelectedRepo()]).catch((error) => {
    setStatus(`Failed to load chats: ${String(error?.message || error)}`);
  });
});

repoSearchInputEl.addEventListener("input", () => {
  repoSearchTerm = String(repoSearchInputEl.value || "");
  renderRepoPanel();
});

modelSelectEl.addEventListener("change", () => {
  localStorage.setItem(SELECTED_MODEL_KEY, String(modelSelectEl.value || ""));
});

Promise.all([loadModels(), loadRepos()])
  .then(() => Promise.all([loadChatsForSelectedRepo(), loadGitHubIntegrationsForSelectedRepo()]))
  .catch((error) => {
    askBtn.disabled = true;
    setStatus(`Startup failed: ${String(error?.message || error)}`);
  });

refreshPinTitleButton();

refreshPullsBtn.addEventListener("click", () => {
  loadPullRequestsForSelectedRepo().catch((error) => {
    setStatus(`Failed to load pull requests: ${String(error?.message || error)}`);
  });
});

refreshClosedPullsBtn.addEventListener("click", () => {
  loadClosedPullRequestsForSelectedRepo().catch((error) => {
    setStatus(`Failed to load closed pull requests: ${String(error?.message || error)}`);
  });
});

closedPullSearchInputEl.addEventListener("input", () => {
  closedPullSearchTerm = String(closedPullSearchInputEl.value || "");
  renderClosedPullRequests();
});

closedPullPrevBtn.addEventListener("click", () => {
  goToClosedPullPage(closedPullPage - 1).catch((error) => {
    setStatus(`Failed to load closed pull requests: ${String(error?.message || error)}`);
  });
});

closedPullNextBtn.addEventListener("click", () => {
  if (!closedPullsHasNextPage) {
    return;
  }

  goToClosedPullPage(closedPullPage + 1).catch((error) => {
    setStatus(`Failed to load closed pull requests: ${String(error?.message || error)}`);
  });
});

refreshArtifactsBtn.addEventListener("click", () => {
  loadArtifactsForSelectedRepo().catch((error) => {
    setStatus(`Failed to load artifacts: ${String(error?.message || error)}`);
  });
});

artifactRunFilterEl.addEventListener("change", () => {
  selectedArtifactRunFilter = String(artifactRunFilterEl.value || "");
  applyArtifactFilters();
  renderArtifacts();
});

artifactExpiredFilterEl.addEventListener("change", () => {
  includeExpiredArtifacts = !!artifactExpiredFilterEl.checked;
  applyArtifactFilters();
  renderArtifacts();
});

closePrDrawerBtn.addEventListener("click", () => {
  closePullRequestDrawer();
});

closeDiffDialogBtn.addEventListener("click", () => {
  closeDiffDialog();
});

prDrawerBackdropEl.addEventListener("click", (event) => {
  if (event.target === prDrawerBackdropEl) {
    closePullRequestDrawer();
  }
});

diffDialogBackdropEl.addEventListener("click", (event) => {
  if (event.target === diffDialogBackdropEl) {
    closeDiffDialog();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && diffDialogBackdropEl.classList.contains("open")) {
    closeDiffDialog();
    return;
  }

  if (event.key === "Escape" && prDrawerBackdropEl.classList.contains("open")) {
    closePullRequestDrawer();
  }
});
