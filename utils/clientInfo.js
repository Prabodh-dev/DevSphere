// The parts of a request that are kept with a login.
export const clientInfo = (req) => ({
  userAgent: String(req.get("user-agent") ?? "").slice(0, 200),
  ip: String(req.ip ?? ""),
});
