import { pinoHttp } from "pino-http";
import { logger } from "../utils/logger.js";
import { routePattern } from "../utils/routePattern.js";

const PROBES = new Set(["/healthz", "/readyz", "/metrics"]);

// One log line per request: method, route pattern, status, duration and the
// request id. Expected client errors (4xx) stay at info, a few notable
// conditions are warnings and unexpected failures are errors.
const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,
  // The fields below replace the default request and response objects.
  serializers: { req: () => undefined, res: () => undefined },
  customAttributeKeys: { responseTime: "durationMs" },
  // pino-http asks for these twice: when the request starts (they become part
  // of req.log, so every log line of the request has the id) and when it ends
  // (they describe the outcome). Each field must appear in only one of them.
  customProps: (req, res) =>
    res.headersSent
      ? {
          method: req.method,
          route: routePattern(req),
          status: res.statusCode,
          ...(res.locals?.errorCode && { errorCode: res.locals.errorCode }),
        }
      : { requestId: req.id },
  customLogLevel: (req, res, err) => {
    if (err || res.locals?.unexpectedError || res.statusCode >= 500) {
      return res.locals?.expectedServerError ? "warn" : "error";
    }
    if (PROBES.has(req.path)) return "debug";
    return "info";
  },
  customSuccessMessage: (req, res) =>
    `${req.method} ${routePattern(req)} ${res.statusCode}`,
  customErrorMessage: (req, res) =>
    `${req.method} ${routePattern(req)} ${res.statusCode}`,
});

export default requestLogger;
