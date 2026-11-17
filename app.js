import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import { notFoundHandler, errorHandler } from "./middlewares/errorHandler.js";
import { limiters } from "./middlewares/rateLimit.js";
import { getTrustProxy } from "./config/env.js";
import { corsMiddleware } from "./middlewares/cors.js";

import v1Routes from "./routes/index.js";

const app = express();

// TRUST_PROXY is the number of reverse proxies in front of the app (default 0).
// It lets req.ip, and so the rate limiters, see the real client address.
app.set("trust proxy", getTrustProxy());

app.use(helmet());
app.use(corsMiddleware);
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "256kb" }));

app.get("/healthz", (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res
    .status(dbUp ? 200 : 503)
    .json({ status: dbUp ? "ok" : "unavailable", db: dbUp ? "up" : "down" });
});

app.use("/api", limiters.general);

app.use("/api/v1", v1Routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
