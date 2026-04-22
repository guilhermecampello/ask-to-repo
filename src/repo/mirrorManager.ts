import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config";
import { GitHubRepo } from "../github/client";
import { getGitHubApiToken } from "../github/auth";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd?: string): Promise<void> {
  logger.debug({ cwd, args }, "Running git command for repository mirror");
  await execFileAsync("git", args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024 * 10,
  });
}

async function isShallowRepository(cwd: string): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd,
    env: process.env,
  });

  return stdout.trim() === "true";
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
  const repoLogger = logger.child({ repoFullName: repo.full_name, mirrorPath, defaultBranch });

  const parentDir = path.dirname(mirrorPath);
  await mkdir(parentDir, { recursive: true });
  repoLogger.debug({ parentDir }, "Ensured mirror parent directory exists");

  if (!existsSync(mirrorPath)) {
    repoLogger.info("Mirror missing, cloning repository with full history");
    await runGit(["clone", "--branch", defaultBranch, cloneUrl, mirrorPath]);
    repoLogger.info("Repository mirror cloned successfully");
    return { synced: true, path: mirrorPath };
  }

  repoLogger.info("Refreshing existing repository mirror");
  await runGit(["remote", "set-url", "origin", cloneUrl], mirrorPath);

  if (await isShallowRepository(mirrorPath)) {
    repoLogger.info("Existing mirror is shallow, converting to full history");
    await runGit(["fetch", "--unshallow", "--tags", "origin"], mirrorPath);
  } else {
    repoLogger.debug("Existing mirror already has full history");
    await runGit(["fetch", "--tags", "origin"], mirrorPath);
  }

  await runGit(["fetch", "origin", defaultBranch], mirrorPath);
  await runGit(["reset", "--hard", `origin/${defaultBranch}`], mirrorPath);
  await runGit(["clean", "-fd"], mirrorPath);
  repoLogger.info("Repository mirror synchronized successfully");

  return { synced: true, path: mirrorPath };
}
