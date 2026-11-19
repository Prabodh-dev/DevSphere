// The one place that reads environment variables. Every value is parsed and
// validated with zod, once, and the rest of the code uses `config`.
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const MIN_JWT_SECRET_LENGTH = 32;
const UNIT_SECONDS = { "": 1, s: 1, m: 60, h: 3600, d: 86400 };
const NODE_ENVS = ["development", "test", "production"];
const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
];

const isBlank = (value) => value === undefined || String(value).trim() === "";

// ---- value types ----
const text = z.string();
const bool = z.enum(["true", "false"]).transform((value) => value === "true");
const count = (min) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine((n) => n >= min);
const seconds = z
  .string()
  .regex(/^\d+[smhd]?$/)
  .transform((value) => {
    const [, amount, unit] = /^(\d+)([smhd]?)$/.exec(value);
    return Number(amount) * UNIT_SECONDS[unit];
  })
  .refine((n) => n > 0);
const oneOf = (values) => z.enum(values);
const originList = z.string().transform((value) =>
  value
    .split(",")
    .map((origin) => origin.trim())
    // A wildcard origin is never allowed.
    .filter((origin) => origin && origin !== "*")
);

// ---- every variable the app reads ----
// name: the environment variable
// type: zod schema for a non-blank value
// message: shown when the value is invalid
// fallback: the value when it is unset or blank (may depend on NODE_ENV)
const variables = [
  {
    name: "NODE_ENV",
    type: oneOf(NODE_ENVS),
    message: "NODE_ENV must be development, test or production",
    fallback: () => "development",
  },
  {
    name: "PORT",
    type: count(1).refine((n) => n <= 65535),
    message: "PORT must be a whole number from 1 to 65535",
    fallback: () => 5000,
  },
  {
    name: "TRUST_PROXY",
    type: count(0),
    message: "TRUST_PROXY must be a whole number of proxy hops",
    fallback: () => 0,
  },
  {
    name: "CORS_ORIGINS",
    type: originList,
    message: "CORS_ORIGINS must be a comma separated list of origins",
    fallback: () => [],
  },

  {
    name: "MONGO_URI",
    type: text,
    message: "MONGO_URI is invalid",
    fallback: () => "",
  },
  {
    name: "JWT_SECRET",
    type: text.min(MIN_JWT_SECRET_LENGTH),
    message: `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
    fallback: () => "",
  },

  {
    name: "ACCESS_TOKEN_TTL",
    type: seconds,
    message: "ACCESS_TOKEN_TTL must look like 30s, 15m, 2h or 1d",
    fallback: () => 15 * 60,
  },
  {
    name: "REFRESH_TOKEN_TTL_DAYS",
    type: count(1),
    message: "REFRESH_TOKEN_TTL_DAYS must be a positive whole number",
    fallback: () => 30,
  },
  {
    name: "COOKIE_SECURE",
    type: bool,
    message: "COOKIE_SECURE must be true or false",
    fallback: () => false,
  },

  {
    name: "MONGO_AUTO_INDEX",
    type: bool,
    message: "MONGO_AUTO_INDEX must be true or false",
    fallback: (c) => c.NODE_ENV !== "production",
  },
  {
    name: "DOCS_ENABLED",
    type: bool,
    message: "DOCS_ENABLED must be true or false",
    fallback: (c) => c.NODE_ENV !== "production",
  },

  {
    name: "REDIS_URL",
    type: text,
    message: "REDIS_URL is invalid",
    fallback: () => "",
  },
  {
    name: "REDIS_KEY_PREFIX",
    type: text,
    message: "REDIS_KEY_PREFIX is invalid",
    fallback: () => "",
  },

  {
    name: "RATE_LIMIT_MAX",
    type: count(1),
    message: "RATE_LIMIT_MAX must be a positive whole number",
    fallback: () => 300,
  },
  {
    name: "AUTH_RATE_LIMIT_MAX",
    type: count(1),
    message: "AUTH_RATE_LIMIT_MAX must be a positive whole number",
    fallback: () => 10,
  },
  {
    name: "REFRESH_RATE_LIMIT_MAX",
    type: count(1),
    message: "REFRESH_RATE_LIMIT_MAX must be a positive whole number",
    fallback: () => 60,
  },
  {
    name: "HIGHLIGHT_RATE_LIMIT_MAX",
    type: count(1),
    message: "HIGHLIGHT_RATE_LIMIT_MAX must be a positive whole number",
    fallback: () => 30,
  },

  // How long a live code edit waits for further edits before it is saved.
  {
    name: "LIVE_CODE_FLUSH_MS",
    type: count(0),
    message: "LIVE_CODE_FLUSH_MS must be a whole number of milliseconds",
    fallback: () => 2000,
  },

  {
    name: "AWS_ACCESS_KEY",
    type: text,
    message: "AWS_ACCESS_KEY is invalid",
    fallback: () => "",
  },
  {
    name: "AWS_SECRET_KEY",
    type: text,
    message: "AWS_SECRET_KEY is invalid",
    fallback: () => "",
  },
  {
    name: "AWS_REGION",
    type: text,
    message: "AWS_REGION is invalid",
    fallback: () => "",
  },
  {
    name: "AVATAR_BUCKET",
    type: text,
    message: "AVATAR_BUCKET is invalid",
    fallback: () => "",
  },
  // Signed links last at most an hour.
  {
    name: "MEDIA_URL_TTL_SECONDS",
    type: count(1).transform((n) => Math.min(n, 3600)),
    message: "MEDIA_URL_TTL_SECONDS must be a positive whole number",
    fallback: () => 300,
  },

  {
    name: "LOG_LEVEL",
    type: oneOf(LOG_LEVELS),
    message: `LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`,
    fallback: () => "info",
  },
  {
    name: "LOG_PRETTY",
    type: bool,
    message: "LOG_PRETTY must be true or false",
    fallback: () => false,
  },
  {
    name: "METRICS_ENABLED",
    type: bool,
    message: "METRICS_ENABLED must be true or false",
    fallback: () => false,
  },
  {
    name: "METRICS_TOKEN",
    type: text,
    message: "METRICS_TOKEN is invalid",
    fallback: () => "",
  },
];

// Names of all the variables, for documentation checks.
export const ENV_VARIABLES = variables.map((variable) => variable.name);

// Parses an environment into the typed settings. Invalid values fall back to
// their defaults and are reported in `problems`.
export function loadConfig(env = process.env) {
  const raw = {};
  const problems = [];

  for (const variable of variables) {
    const given = env[variable.name];
    if (isBlank(given)) {
      raw[variable.name] = variable.fallback(raw);
      continue;
    }
    const parsed = variable.type.safeParse(String(given).trim());
    if (parsed.success) {
      raw[variable.name] = parsed.data;
    } else {
      problems.push(variable.message);
      raw[variable.name] = variable.fallback(raw);
    }
  }

  return {
    config: {
      env: raw.NODE_ENV,
      port: raw.PORT,
      trustProxy: raw.TRUST_PROXY,
      corsOrigins: raw.CORS_ORIGINS,
      mongoUri: raw.MONGO_URI,
      jwtSecret: raw.JWT_SECRET,
      auth: {
        accessTokenTtlSeconds: raw.ACCESS_TOKEN_TTL,
        refreshTokenTtlDays: raw.REFRESH_TOKEN_TTL_DAYS,
        cookieSecure: raw.COOKIE_SECURE,
      },
      mongoAutoIndex: raw.MONGO_AUTO_INDEX,
      docsEnabled: raw.DOCS_ENABLED,
      redis: { url: raw.REDIS_URL, keyPrefix: raw.REDIS_KEY_PREFIX },
      liveCode: { flushMs: raw.LIVE_CODE_FLUSH_MS },
      rateLimit: {
        general: raw.RATE_LIMIT_MAX,
        auth: raw.AUTH_RATE_LIMIT_MAX,
        refresh: raw.REFRESH_RATE_LIMIT_MAX,
        highlight: raw.HIGHLIGHT_RATE_LIMIT_MAX,
      },
      aws: {
        accessKey: raw.AWS_ACCESS_KEY,
        secretKey: raw.AWS_SECRET_KEY,
        region: raw.AWS_REGION,
        bucket: raw.AVATAR_BUCKET,
      },
      mediaUrlTtlSeconds: raw.MEDIA_URL_TTL_SECONDS,
      log: { level: raw.LOG_LEVEL, pretty: raw.LOG_PRETTY },
      metrics: { enabled: raw.METRICS_ENABLED, token: raw.METRICS_TOKEN },
    },
    problems,
  };
}

// Problems that stop the server from starting: invalid values, and the two
// settings it cannot run without.
export function getEnvProblems(env = process.env) {
  const { config: parsed, problems } = loadConfig(env);
  const missing = [];
  if (!parsed.mongoUri) missing.push("MONGO_URI is required");
  if (isBlank(env.JWT_SECRET)) missing.push("JWT_SECRET is required");
  return [...missing, ...problems];
}

// The settings, read once when the module is first imported.
export const config = loadConfig().config;

// Re-reads the environment into `config`. The app never calls this; tests do
// after changing process.env.
export function reloadConfig(env = process.env) {
  Object.assign(config, loadConfig(env).config);
  return config;
}
