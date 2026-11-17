// The route a request matched, as a pattern such as /api/v1/users/:id/follow.
// Using the pattern instead of the real path keeps ids out of logs and metrics.
//
// A router sets req.routeBase (see setRouteBase) because Express forgets the
// mount path once a request has left the router, for example on errors.
export function routePattern(req) {
  const path = req.route?.path;
  if (typeof path !== "string") return "unmatched";
  return `${req.routeBase ?? req.baseUrl ?? ""}${path === "/" ? "" : path}`;
}

// Middleware that records where a router is mounted.
export const setRouteBase = (base) => (req, res, next) => {
  req.routeBase = base;
  next();
};
