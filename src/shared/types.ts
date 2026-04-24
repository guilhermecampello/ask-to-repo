export type AskRequest = {
  question: string;
  repoFullName: string;
  model?: string;
  chatId: string;
};

export type AskStreamEvent =
  | { type: "status"; message: string }
  | { type: "chunk"; content: string }
  | { type: "tool_activity"; content: string }
  | { type: "error"; message: string }
  | { type: "done"; code: number; chatId: string; copilotSessionId: string | null };

export type ChatSummary = {
  id: string;
  repoFullName: string;
  title: string;
  titlePinned: boolean;
  model: string;
  copilotSessionId: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string;
  createdAt: number;
  toolActivity?: string;
};

export type ChatDetail = {
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

export type ListChatsResponse = {
  chats: ChatSummary[];
};

export type CreateChatRequest = {
  repoFullName: string;
  title?: string;
  model?: string;
  copilotSessionId?: string;
};

export type CreateChatResponse = {
  chat: ChatDetail;
};

export type GetChatResponse = {
  chat: ChatDetail;
};

export type SetChatTitlePinRequest = {
  pinned: boolean;
};

export type SetChatTitlePinResponse = {
  chat: ChatDetail;
};

export type HealthResponse = {
  ok: boolean;
  uptimeSec: number;
};

export type RepoSummary = {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  isPrivate: boolean;
  defaultBranch: string;
  isCloned: boolean;
};

export type ModelOption = {
  id: string;
  label: string;
  requestMultiplier: string;
};

export type ModelsResponse = {
  defaultModel: string;
  models: string[];
  modelOptions: ModelOption[];
};

export type PullRequestSummary = {
  id: number;
  number: number;
  title: string;
  author: string;
  state: string;
  closeStatus: "open" | "merged" | "closed";
  draft: boolean;
  url: string;
  updatedAt: string;
};

export type ListPullRequestsResponse = {
  repoFullName: string;
  pullRequests: PullRequestSummary[];
  page: number;
  perPage: number;
  hasNextPage: boolean;
};

export type PullRequestFileSummary = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
};

export type PullRequestCheckSummary = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type PullRequestDetail = {
  id: number;
  number: number;
  title: string;
  author: string;
  state: string;
  draft: boolean;
  url: string;
  body: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  commits: number;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  merged: boolean;
  mergeable: boolean | null;
  updatedAt: string;
  files: PullRequestFileSummary[];
  checks: PullRequestCheckSummary[];
};

export type PullRequestDetailResponse = {
  repoFullName: string;
  pullRequest: PullRequestDetail;
};

export type ArtifactSummary = {
  id: number;
  name: string;
  sizeInBytes: number;
  expired: boolean;
  createdAt: string;
  expiresAt: string;
  archiveDownloadUrl: string;
  downloadPath: string;
  workflowRunId: number | null;
  workflowRunUrl: string | null;
};

export type ListArtifactsResponse = {
  repoFullName: string;
  totalCount: number;
  artifacts: ArtifactSummary[];
};
