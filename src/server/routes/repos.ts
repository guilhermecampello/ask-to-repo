import { Router } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { listAccessibleRepos } from "../../github/client";
import { RepoSummary } from "../../shared/types";
import { config } from "../../config";

export const reposRouter = Router();

function toMirrorPath(repoFullName: string): string {
  const safe = repoFullName.replaceAll("/", "__");
  return path.join(config.REPO_LOCAL_PATH, safe);
}

reposRouter.get("/repos", async (_req, res) => {
  try {
    const repos = await listAccessibleRepos();
    const payload: RepoSummary[] = repos
      .map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        owner: repo.owner.login,
        isPrivate: repo.private,
        defaultBranch: repo.default_branch,
        isCloned: existsSync(toMirrorPath(repo.full_name)),
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    res.json({ repos: payload });
  } catch (error) {
    res.status(500).json({
      error: (error as Error).message,
    });
  }
});
