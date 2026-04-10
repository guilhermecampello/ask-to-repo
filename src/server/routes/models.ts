import { Router } from "express";
import { config, getAvailableModels } from "../../config";
import { ModelsResponse } from "../../shared/types";

export const modelsRouter = Router();

modelsRouter.get("/models", (_req, res) => {
  try {
    const payload: ModelsResponse = {
      defaultModel: config.COPILOT_DEFAULT_MODEL,
      models: getAvailableModels(),
    };

    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
