import { httpRequestDuration } from "../utils/metrics.js";
import { routePattern } from "../utils/routePattern.js";

// Times every request. The route is the matched pattern, not the real path.
const httpMetrics = (req, res, next) => {
  const started = process.hrtime.bigint();

  res.on("finish", () => {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    httpRequestDuration.observe(
      {
        method: req.method,
        route: routePattern(req),
        status_class: `${Math.floor(res.statusCode / 100)}xx`,
      },
      seconds
    );
  });

  next();
};

export default httpMetrics;
