import { config } from "../config";
import { getGitHubApiToken } from "./auth";

export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  clone_url: string;
  owner: {
    login: string;
  };
};

export type GitHubPullRequest = {
  id: number;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  html_url: string;
  updated_at: string;
  merged_at?: string | null;
  user: {
    login: string;
  };
};

export type GitHubPullRequestDetail = GitHubPullRequest & {
  body: string | null;
  changed_files: number;
  additions: number;
  deletions: number;
  commits: number;
  merged: boolean;
  mergeable: boolean | null;
  base: {
    ref: string;
  };
  head: {
    ref: string;
    sha: string;
  };
};

export type GitHubPullRequestFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string | null;
};

export type GitHubCheckRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
  started_at: string | null;
  completed_at: string | null;
};

type GitHubCheckRunsResponse = {
  total_count: number;
  check_runs: GitHubCheckRun[];
};

export type GitHubArtifact = {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
  created_at: string;
  expires_at: string;
  archive_download_url: string;
  workflow_run?: {
    id: number;
    html_url: string;
  } | null;
};

type GitHubArtifactsResponse = {
  total_count: number;
  artifacts: GitHubArtifact[];
};

type PaginatedReposResponse = GitHubRepo[];

async function ghFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  const token = await getGitHubApiToken();
  const response = await fetch(`${config.GITHUB_API_BASE_URL}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

async function ghRequest(pathname: string, init?: RequestInit): Promise<Response> {
  const token = await getGitHubApiToken();
  return fetch(`${config.GITHUB_API_BASE_URL}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers || {}),
    },
  });
}

export async function listAccessibleRepos(): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const chunk = await ghFetch<PaginatedReposResponse>(
      `/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=full_name&per_page=100&page=${page}`
    );

    repos.push(...chunk);

    if (chunk.length < 100) {
      break;
    }
  }

  return repos;
}

export async function getRepoByFullName(fullName: string): Promise<GitHubRepo> {
  const [owner, repo] = parseRepoFullName(fullName);
  return ghFetch<GitHubRepo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
}

function parseRepoFullName(fullName: string): [string, string] {
  const normalized = fullName.trim();
  const parts = normalized.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid repoFullName. Expected format 'owner/repo'.");
  }

  return [parts[0], parts[1]];
}

export async function listPullRequestsByState(
  repoFullName: string,
  state: "open" | "closed" = "open",
  options?: { page?: number; perPage?: number }
): Promise<GitHubPullRequest[]> {
  const [owner, repo] = parseRepoFullName(repoFullName);
  const page = Math.max(1, Number(options?.page || 1));
  const perPage = Math.min(100, Math.max(1, Number(options?.perPage || 25)));

  return ghFetch<GitHubPullRequest[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&sort=updated&direction=desc&per_page=${perPage}&page=${page}`
  );
}

export async function listWorkflowArtifacts(repoFullName: string): Promise<GitHubArtifactsResponse> {
  const [owner, repo] = parseRepoFullName(repoFullName);

  return ghFetch<GitHubArtifactsResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/artifacts?per_page=30`
  );
}

export async function getPullRequestDetails(
  repoFullName: string,
  pullNumber: number
): Promise<GitHubPullRequestDetail> {
  const [owner, repo] = parseRepoFullName(repoFullName);

  return ghFetch<GitHubPullRequestDetail>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`
  );
}

export async function listPullRequestFiles(
  repoFullName: string,
  pullNumber: number
): Promise<GitHubPullRequestFile[]> {
  const [owner, repo] = parseRepoFullName(repoFullName);
  return ghFetch<GitHubPullRequestFile[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/files?per_page=100`
  );
}

export async function listCheckRunsForRef(repoFullName: string, ref: string): Promise<GitHubCheckRun[]> {
  const [owner, repo] = parseRepoFullName(repoFullName);
  const response = await ghFetch<GitHubCheckRunsResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`
  );

  return response.check_runs;
}

export async function getArtifactDownloadUrl(repoFullName: string, artifactId: number): Promise<string> {
  const [owner, repo] = parseRepoFullName(repoFullName);
  const response = await ghRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/artifacts/${artifactId}/zip`,
    {
      method: "GET",
      redirect: "manual",
    }
  );

  if (response.status === 302 || response.status === 301) {
    const location = response.headers.get("location");
    if (!location) {
      throw new Error("Artifact download redirect was missing a location header.");
    }
    return location;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub artifact download request failed (${response.status}): ${text}`);
  }

  const finalUrl = response.url;
  if (!finalUrl) {
    throw new Error("Unable to resolve artifact download URL.");
  }

  return finalUrl;
}
