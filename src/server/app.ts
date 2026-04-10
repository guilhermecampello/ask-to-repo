import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "node:path";
import { config } from "../config";
import { logger } from "../logger";
import { askRouter } from "./routes/ask";
import { healthRouter } from "./routes/health";
import { syncRouter } from "./routes/sync";
import { reposRouter } from "./routes/repos";
import { modelsRouter } from "./routes/models";

const app = express();

app.use(
  cors({
    origin: config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN,
  })
);
app.use(helmet());
app.use(express.json({ limit: "256kb" }));
app.use(pinoHttp({ logger }));

app.use("/api", healthRouter);
app.use("/api", reposRouter);
app.use("/api", modelsRouter);
app.use("/api", askRouter);
app.use("/api", syncRouter);
app.use("/vendor/marked", express.static(path.resolve(process.cwd(), "node_modules/marked/lib")));
app.use("/vendor/dompurify", express.static(path.resolve(process.cwd(), "node_modules/dompurify/dist")));
app.use(express.static(path.resolve(process.cwd(), "web")));

app.get("/{*path}", (_req, res) => {
  res.sendFile(path.resolve(process.cwd(), "web/index.html"));
});

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "Server started");
});
