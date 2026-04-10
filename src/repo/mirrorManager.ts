import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config";
import { GitHubRepo } from "../github/client";
import { getGitHubApiToken } from "../github/auth";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd?: string): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024 * 10,
  });
}

function toMirrorPath(repoFullName: string): string {
  const safe = repoFullName.replaceAll("/", "__");
  return path.join(config.REPO_LOCAL_PATH, safe);
}

async function buildAuthenticatedCloneUrl(cloneUrl: string): Promise<string> {
  const token = await getGitHubApiToken();
  const url = new URL(cloneUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}

export async function ensureMirrorReady(repo: GitHubRepo): Promise<{ synced: boolean; path: string }> {
  const mirrorPath = toMirrorPath(repo.full_name);
  const cloneUrl = await buildAuthenticatedCloneUrl(repo.clone_url);
  const defaultBranch = repo.default_branch || "main";

  const parentDir = path.dirname(mirrorPath);
  await mkdir(parentDir, { recursive: true });

  if (!existsSync(mirrorPath)) {
    await runGit(["clone", "--depth", "1", "--branch", defaultBranch, cloneUrl, mirrorPath]);
    return { synced: true, path: mirrorPath };
  }

  await runGit(["remote", "set-url", "origin", cloneUrl], mirrorPath);
  await runGit(["fetch", "origin", defaultBranch, "--depth", "1"], mirrorPath);
  await runGit(["reset", "--hard", `origin/${defaultBranch}`], mirrorPath);
  await runGit(["clean", "-fd"], mirrorPath);

  return { synced: true, path: mirrorPath };
}
