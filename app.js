import express from "express";
import helmet from "helmet";
import { notFoundHandler, errorHandler } from "./middlewares/errorHandler.js";
import { limiters } from "./middlewares/rateLimit.js";
import { config } from "./config/index.js";
import { corsMiddleware } from "./middlewares/cors.js";
import { setRouteBase } from "./utils/routePattern.js";
import requestId from "./middlewares/requestId.js";
import requestLogger from "./middlewares/requestLogger.js";
import httpMetrics from "./middlewares/httpMetrics.js";
import metricsRoutes from "./routes/metrics.js";
import healthRoutes from "./routes/health.js";

import v1Routes from "./routes/index.js";
import docsRoutes from "./routes/docs.js";

const app = express();

// TRUST_PROXY is the number of reverse proxies in front of the app (default 0).
// It lets req.ip, and so the rate limiters, see the real client address.
app.set("trust proxy", config.trustProxy);

app.use(requestId);
app.use(requestLogger);
app.use(httpMetrics);
app.use(helmet());
app.use(corsMiddleware);
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "256kb" }));

app.use(healthRoutes);
app.use(metricsRoutes);

app.use("/api", limiters.general);

if (config.docsEnabled) {
  app.use("/api/v1", setRouteBase("/api/v1"), docsRoutes);
}
app.use("/api/v1", v1Routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
