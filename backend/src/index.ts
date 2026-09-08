import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import { config } from "./config/env";
import { authRouter } from "./routes/auth";
import { captureRouter } from "./routes/capture";
import { apiRouter } from "./routes/api";
import { addClient } from "./ws/hub";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ewallet-recon-api", time: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/capture", captureRouter);
app.use("/api", apiRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  try {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    if (!token) {
      ws.close(4401, "Missing token");
      return;
    }
    jwt.verify(token, config.jwtSecret);
    addClient(ws);
    ws.send(JSON.stringify({ type: "connected", payload: { ok: true } }));
  } catch {
    ws.close(4401, "Invalid token");
  }
});

server.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${config.port}`);
  console.log(`WebSocket ws://${config.host}:${config.port}/ws`);
});
