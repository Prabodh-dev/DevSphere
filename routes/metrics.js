import express from "express";
import { createHash, timingSafeEqual } from "crypto";
import { config } from "../config/index.js";
import { notFound, unauthorized } from "../utils/httpError.js";
import { registry } from "../utils/metrics.js";

const router = express.Router();

// Compares without leaking where two values differ.
const sameToken = (given, expected) =>
  timingSafeEqual(
    createHash("sha256").update(given).digest(),
    createHash("sha256").update(expected).digest()
  );

// GET /metrics is only served when METRICS_ENABLED=true, and then only with
// the bearer token if METRICS_TOKEN is set.
router.get("/metrics", async (req, res) => {
  if (!config.metrics.enabled) throw notFound("Route not found");

  if (config.metrics.token) {
    const header = req.get("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!given || !sameToken(given, config.metrics.token)) {
      res.set("WWW-Authenticate", 'Bearer realm="metrics"');
      throw unauthorized("Metrics token required");
    }
  }

  res.set("Content-Type", registry.contentType);
  res.set("Cache-Control", "no-store");
  res.send(await registry.metrics());
});

export default router;
