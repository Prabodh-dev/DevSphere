const REQUIRED = ["MONGO_URI", "JWT_SECRET"];
const MIN_JWT_SECRET_LENGTH = 32;

const isBlank = (value) => !value || !String(value).trim();

const DURATION = /^(\d+)([smhd]?)$/;
const UNIT_SECONDS = { "": 1, s: 1, m: 60, h: 3600, d: 86400 };

// "30s", "15m", "2h", "1d" or a plain number of seconds. Null when invalid.
const parseDuration = (value) => {
  const match = DURATION.exec(String(value).trim());
  if (!match) return null;
  const seconds = Number(match[1]) * UNIT_SECONDS[match[2]];
  return seconds > 0 ? seconds : null;
};

const parseCount = (value, { min }) => {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return number >= min ? number : null;
};

// Lifetime of access tokens in seconds (default 15 minutes).
export const getAccessTokenTtlSeconds = (env = process.env) =>
  isBlank(env.ACCESS_TOKEN_TTL)
    ? 15 * 60
    : (parseDuration(env.ACCESS_TOKEN_TTL) ?? 15 * 60);

// Lifetime of refresh tokens in days (default 30).
export const getRefreshTtlDays = (env = process.env) =>
  isBlank(env.REFRESH_TOKEN_TTL_DAYS)
    ? 30
    : (parseCount(env.REFRESH_TOKEN_TTL_DAYS, { min: 1 }) ?? 30);

// Number of reverse proxies in front of the app (default 0).
export const getTrustProxy = (env = process.env) =>
  isBlank(env.TRUST_PROXY) ? 0 : (parseCount(env.TRUST_PROXY, { min: 0 }) ?? 0);

export const isCookieSecure = (env = process.env) =>
  String(env.COOKIE_SECURE ?? "").trim() === "true";

// Mongoose builds missing indexes on startup unless this is off. On by default,
// except in production where indexes are synced explicitly (pnpm db:indexes).
export const getAutoIndex = (env = process.env) => {
  const flag = String(env.MONGO_AUTO_INDEX ?? "").trim();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return String(env.NODE_ENV ?? "").trim() !== "production";
};

// Serve the API docs page and the OpenAPI document. On by default, except in
// production.
export const getDocsEnabled = (env = process.env) => {
  const flag = String(env.DOCS_ENABLED ?? "").trim();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return String(env.NODE_ENV ?? "").trim() !== "production";
};

// Returns a list of human readable problems with the environment.
export const getEnvProblems = (env = process.env) => {
  const problems = REQUIRED.filter((name) => isBlank(env[name])).map(
    (name) => `${name} is required`
  );

  if (
    !isBlank(env.JWT_SECRET) &&
    String(env.JWT_SECRET).length < MIN_JWT_SECRET_LENGTH
  ) {
    problems.push(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`
    );
  }

  if (!isBlank(env.ACCESS_TOKEN_TTL) && !parseDuration(env.ACCESS_TOKEN_TTL)) {
    problems.push("ACCESS_TOKEN_TTL must look like 30s, 15m, 2h or 1d");
  }
  if (
    !isBlank(env.REFRESH_TOKEN_TTL_DAYS) &&
    parseCount(env.REFRESH_TOKEN_TTL_DAYS, { min: 1 }) === null
  ) {
    problems.push("REFRESH_TOKEN_TTL_DAYS must be a positive whole number");
  }
  if (
    !isBlank(env.TRUST_PROXY) &&
    parseCount(env.TRUST_PROXY, { min: 0 }) === null
  ) {
    problems.push("TRUST_PROXY must be a whole number of proxy hops");
  }
  if (
    !isBlank(env.COOKIE_SECURE) &&
    !["true", "false"].includes(String(env.COOKIE_SECURE).trim())
  ) {
    problems.push("COOKIE_SECURE must be true or false");
  }
  if (
    !isBlank(env.MONGO_AUTO_INDEX) &&
    !["true", "false"].includes(String(env.MONGO_AUTO_INDEX).trim())
  ) {
    problems.push("MONGO_AUTO_INDEX must be true or false");
  }
  if (
    !isBlank(env.DOCS_ENABLED) &&
    !["true", "false"].includes(String(env.DOCS_ENABLED).trim())
  ) {
    problems.push("DOCS_ENABLED must be true or false");
  }
  return problems;
};

// Allowed browser origins, from a comma separated list. A wildcard is ignored.
export const getCorsOrigins = (env = process.env) =>
  String(env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin && origin !== "*");
