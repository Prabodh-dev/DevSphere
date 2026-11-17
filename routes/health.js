import express from "express";
import mongoose from "mongoose";
import { getRedisStatus } from "../config/redis.js";

const router = express.Router();

const dbIsUp = () => mongoose.connection.readyState === 1;

// Liveness: the process is running; the database state is included.
router.get("/healthz", (req, res) => {
  const up = dbIsUp();
  res
    .status(up ? 200 : 503)
    .json({ status: up ? "ok" : "unavailable", db: up ? "up" : "down" });
});

// Readiness: ready to serve only while MongoDB is connected. Redis is
// optional, so it is reported but never makes the app unready.
router.get("/readyz", (req, res) => {
  const up = dbIsUp();
  res.status(up ? 200 : 503).json({
    status: up ? "ok" : "unavailable",
    db: up ? "up" : "down",
    redis: getRedisStatus(),
  });
});

export default router;
