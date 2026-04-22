import { Router } from "express";
import { logger } from "../../logger";
import {
  getArtifactDownloadUrl,
  getPullRequestDetails,
  listPullRequestsByState,
  listCheckRunsForRef,
  listPullRequestFiles,
  listWorkflowArtifacts,
} from "../../github/client";
import { ArtifactSummary, PullRequestDetail, PullRequestSummary } from "../../shared/types";

export const githubRouter = Router();

githubRouter.get("/github/pulls", async (req, res) => {
  const repoFullName = String(req.query.repoFullName || "").trim();
  const state = String(req.query.state || "open").trim().toLowerCase();
  const pageRaw = Number.parseInt(String(req.query.page || "1"), 10);
  const perPageRaw = Number.parseInt(String(req.query.perPage || "25"), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const perPage = Number.isFinite(perPageRaw) && perPageRaw > 0 ? Math.min(100, perPageRaw) : 25;
  if (!repoFullName) {
    res.status(400).json({ error: "Field 'repoFullName' is required." });
    return;
  }

  if (state !== "open" && state !== "closed") {
    res.status(400).json({ error: "Field 'state' must be either 'open' or 'closed'." });
    return;
  }

  try {
    const pullRequests = await listPullRequestsByState(repoFullName, state as "open" | "closed", {
      page,
      perPage,
    });
    const payload: PullRequestSummary[] = pullRequests.map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      author: pr.user.login,
      state: pr.state,
      closeStatus: pr.state === "open" ? "open" : pr.merged_at ? "merged" : "closed",
      draft: !!pr.draft,
      url: pr.html_url,
      updatedAt: pr.updated_at,
    }));
    const hasNextPage = payload.length === perPage;

    logger.info({ repoFullName, state, page, perPage, count: payload.length, hasNextPage }, "Listed pull requests");
    res.json({
      repoFullName,
      pullRequests: payload,
      page,
      perPage,
      hasNextPage,
    });
  } catch (error) {
    logger.error({ err: error, repoFullName, state, page, perPage }, "Failed to list pull requests");
    res.status(500).json({ error: (error as Error).message });
  }
});

githubRouter.get("/github/artifacts", async (req, res) => {
  const repoFullName = String(req.query.repoFullName || "").trim();
  if (!repoFullName) {
    res.status(400).json({ error: "Field 'repoFullName' is required." });
    return;
  }

  try {
    const artifactsResponse = await listWorkflowArtifacts(repoFullName);
    const payload: ArtifactSummary[] = artifactsResponse.artifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      sizeInBytes: artifact.size_in_bytes,
      expired: artifact.expired,
      createdAt: artifact.created_at,
      expiresAt: artifact.expires_at,
      archiveDownloadUrl: artifact.archive_download_url,
      downloadPath: `/api/github/artifacts/${artifact.id}/download?repoFullName=${encodeURIComponent(repoFullName)}`,
      workflowRunId: artifact.workflow_run?.id ?? null,
      workflowRunUrl: artifact.workflow_run?.html_url ?? null,
    }));

    logger.info({ repoFullName, count: payload.length }, "Listed workflow artifacts");
    res.json({
      repoFullName,
      totalCount: artifactsResponse.total_count,
      artifacts: payload,
    });
  } catch (error) {
    logger.error({ err: error, repoFullName }, "Failed to list workflow artifacts");
    res.status(500).json({ error: (error as Error).message });
  }
});

githubRouter.get("/github/artifacts/:artifactId/download", async (req, res) => {
  const repoFullName = String(req.query.repoFullName || "").trim();
  const artifactId = Number.parseInt(String(req.params.artifactId || ""), 10);

  if (!repoFullName) {
    res.status(400).json({ error: "Field 'repoFullName' is required." });
    return;
  }

  if (!Number.isFinite(artifactId) || artifactId <= 0) {
    res.status(400).json({ error: "Field 'artifactId' must be a positive integer." });
    return;
  }

  try {
    const downloadUrl = await getArtifactDownloadUrl(repoFullName, artifactId);
    logger.info({ repoFullName, artifactId }, "Redirecting to signed artifact download URL");
    res.redirect(downloadUrl);
  } catch (error) {
    logger.error({ err: error, repoFullName, artifactId }, "Failed to resolve artifact download URL");
    res.status(500).json({ error: (error as Error).message });
  }
});

githubRouter.get("/github/pulls/:pullNumber", async (req, res) => {
  const repoFullName = String(req.query.repoFullName || "").trim();
  const pullNumber = Number.parseInt(String(req.params.pullNumber || ""), 10);

  if (!repoFullName) {
    res.status(400).json({ error: "Field 'repoFullName' is required." });
    return;
  }

  if (!Number.isFinite(pullNumber) || pullNumber <= 0) {
    res.status(400).json({ error: "Field 'pullNumber' must be a positive integer." });
    return;
  }

  try {
    const pr = await getPullRequestDetails(repoFullName, pullNumber);
    const [files, checks] = await Promise.all([
      listPullRequestFiles(repoFullName, pullNumber),
      listCheckRunsForRef(repoFullName, pr.head.sha),
    ]);

    const pullRequest: PullRequestDetail = {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      author: pr.user.login,
      state: pr.state,
      draft: !!pr.draft,
      url: pr.html_url,
      body: pr.body || "",
      changedFiles: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      commits: pr.commits,
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      headSha: pr.head.sha,
      merged: pr.merged,
      mergeable: pr.mergeable,
      updatedAt: pr.updated_at,
      files: files.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: typeof file.patch === "string" ? file.patch : null,
      })),
      checks: checks.map((check) => ({
        id: check.id,
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
        detailsUrl: check.details_url,
        startedAt: check.started_at,
        completedAt: check.completed_at,
      })),
    };

    logger.info({ repoFullName, pullNumber, fileCount: pullRequest.files.length, checkCount: pullRequest.checks.length }, "Loaded pull request detail");
    res.json({ repoFullName, pullRequest });
  } catch (error) {
    logger.error({ err: error, repoFullName, pullNumber }, "Failed to load pull request detail");
    res.status(500).json({ error: (error as Error).message });
  }
});
