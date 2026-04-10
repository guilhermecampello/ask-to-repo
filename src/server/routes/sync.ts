import { Router } from "express";
import { ensureMirrorReady } from "../../repo/mirrorManager";
import { getRepoByFullName } from "../../github/client";

export const syncRouter = Router();

syncRouter.post("/sync", async (req, res) => {
  const repoFullName = String(req.body?.repoFullName || "").trim();
  if (!repoFullName) {
    res.status(400).json({
      ok: false,
      error: "Field 'repoFullName' is required.",
    });
    return;
  }

  try {
    const repo = await getRepoByFullName(repoFullName);
    const result = await ensureMirrorReady(repo);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: (error as Error).message,
    });
  }
});
