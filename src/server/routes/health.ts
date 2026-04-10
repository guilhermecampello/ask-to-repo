import { Router } from "express";
import { HealthResponse } from "../../shared/types";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  const payload: HealthResponse = {
    ok: true,
    uptimeSec: Math.floor(process.uptime()),
  };

  res.json(payload);
});
