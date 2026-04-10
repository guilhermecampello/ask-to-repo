export type AskRequest = {
  question: string;
  repoFullName: string;
  model?: string;
  sessionId?: string;
};

export type AskStreamEvent =
  | { type: "status"; message: string }
  | { type: "chunk"; content: string }
  | { type: "error"; message: string }
  | { type: "done"; code: number };

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
};

export type ModelsResponse = {
  defaultModel: string;
  models: string[];
};
