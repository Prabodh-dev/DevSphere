import client from "prom-client";

// All metrics live in one registry. Labels only ever hold values from small,
// fixed sets (method, route pattern, status class, event name, outcome), so
// nothing about a user, a token or a request path can end up in them.
export const registry = new client.Registry();

client.collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_class"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const socketConnections = new client.Gauge({
  name: "socket_connections",
  help: "Open Socket.IO connections",
  registers: [registry],
});

export const socketEvents = new client.Counter({
  name: "socket_events_total",
  help: "Socket.IO events handled, by event name",
  labelNames: ["event"],
  registers: [registry],
});

export const refreshOutcomes = new client.Counter({
  name: "auth_refresh_total",
  help: "Refresh token exchanges, by outcome",
  labelNames: ["outcome"],
  registers: [registry],
});

// outcome: "rotated", "reuse_detected" or "rejected"
export const countRefresh = (outcome) => refreshOutcomes.inc({ outcome });
