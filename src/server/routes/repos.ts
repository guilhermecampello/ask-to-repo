import { Router } from "express";
import { listAccessibleRepos } from "../../github/client";
import { RepoSummary } from "../../shared/types";

export const reposRouter = Router();

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
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    res.json({ repos: payload });
  } catch (error) {
    res.status(500).json({
      error: (error as Error).message,
    });
  }
});
