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
  const normalized = fullName.trim();
  const parts = normalized.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid repoFullName. Expected format 'owner/repo'.");
  }

  const [owner, repo] = parts;
  return ghFetch<GitHubRepo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
}
