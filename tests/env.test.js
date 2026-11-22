import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ENV_VARIABLES,
  getConfigWarnings,
  getEnvProblems,
  loadConfig,
} from "../config/index.js";
import { toPosix } from "./helpers/paths.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LONG_SECRET = "x".repeat(32);
const base = { MONGO_URI: "m", JWT_SECRET: LONG_SECRET };
const cfg = (env) => loadConfig(env).config;

describe("getEnvProblems", () => {
  it("lists missing and blank required variables", () => {
    expect(getEnvProblems({})).toEqual([
      "MONGO_URI is required",
      "JWT_SECRET is required",
    ]);
    expect(
      getEnvProblems({ MONGO_URI: "  ", JWT_SECRET: LONG_SECRET })
    ).toEqual(["MONGO_URI is required"]);
  });

  it("requires a long enough JWT secret", () => {
    expect(getEnvProblems({ MONGO_URI: "m", JWT_SECRET: "short" })).toEqual([
      "JWT_SECRET must be at least 32 characters",
    ]);
  });

  it("returns nothing when everything is fine", () => {
    expect(getEnvProblems(base)).toEqual([]);
  });

  it("reports invalid values", () => {
    const cases = [
      [
        { ACCESS_TOKEN_TTL: "soon" },
        "ACCESS_TOKEN_TTL must look like 30s, 15m, 2h or 1d",
      ],
      [
        { ACCESS_TOKEN_TTL: "0m" },
        "ACCESS_TOKEN_TTL must look like 30s, 15m, 2h or 1d",
      ],
      [
        { REFRESH_TOKEN_TTL_DAYS: "0" },
        "REFRESH_TOKEN_TTL_DAYS must be a positive whole number",
      ],
      [
        { TRUST_PROXY: "yes" },
        "TRUST_PROXY must be a number of proxy hops or a list of proxy addresses or subnets",
      ],
      [{ COOKIE_SECURE: "maybe" }, "COOKIE_SECURE must be true or false"],
      [
        { MONGO_AUTO_INDEX: "sometimes" },
        "MONGO_AUTO_INDEX must be true or false",
      ],
      [{ DOCS_ENABLED: "maybe" }, "DOCS_ENABLED must be true or false"],
      [{ LOG_PRETTY: "yes" }, "LOG_PRETTY must be true or false"],
      [{ METRICS_ENABLED: "1" }, "METRICS_ENABLED must be true or false"],
      [
        { LOG_LEVEL: "loud" },
        "LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent",
      ],
      [{ PORT: "99999" }, "PORT must be a whole number from 1 to 65535"],
      [{ PORT: "http" }, "PORT must be a whole number from 1 to 65535"],
      [
        { NODE_ENV: "staging" },
        "NODE_ENV must be development, test or production",
      ],
      [
        { RATE_LIMIT_MAX: "0" },
        "RATE_LIMIT_MAX must be a positive whole number",
      ],
      [
        { AUTH_RATE_LIMIT_MAX: "lots" },
        "AUTH_RATE_LIMIT_MAX must be a positive whole number",
      ],
    ];
    for (const [extra, message] of cases) {
      expect(
        getEnvProblems({ ...base, ...extra }),
        JSON.stringify(extra)
      ).toEqual([message]);
    }
  });

  it("accepts valid values", () => {
    expect(
      getEnvProblems({
        ...base,
        ACCESS_TOKEN_TTL: "15m",
        REFRESH_TOKEN_TTL_DAYS: "30",
        TRUST_PROXY: "1",
        COOKIE_SECURE: "true",
        LOG_LEVEL: "debug",
        PORT: "8080",
        METRICS_ENABLED: "true",
        METRICS_TOKEN: "anything",
      })
    ).toEqual([]);
  });
});

describe("config", () => {
  it("has typed defaults for an empty environment", () => {
    expect(cfg({})).toEqual({
      env: "development",
      port: 5000,
      trustProxy: 0,
      corsOrigins: [],
      mongoUri: "",
      jwtSecret: "",
      auth: {
        accessTokenTtlSeconds: 900,
        refreshTokenTtlDays: 30,
        cookieSecure: false,
      },
      mongoAutoIndex: true,
      docsEnabled: true,
      redis: { url: "", keyPrefix: "" },
      liveCode: { flushMs: 2000 },
      chatMedia: { imageMaxBytes: 10485760, fileMaxBytes: 20971520 },
      rateLimit: { general: 300, auth: 10, refresh: 60, highlight: 30 },
      aws: { accessKey: "", secretKey: "", region: "", bucket: "" },
      mediaUrlTtlSeconds: 300,
      log: { level: "info", pretty: false },
      metrics: { enabled: false, token: "" },
    });
  });

  it("reads durations in seconds, minutes, hours and days", () => {
    const seconds = (value) =>
      cfg({ ACCESS_TOKEN_TTL: value }).auth.accessTokenTtlSeconds;
    expect(seconds("30s")).toBe(30);
    expect(seconds("10m")).toBe(600);
    expect(seconds("2h")).toBe(7200);
    expect(seconds("1d")).toBe(86400);
    expect(seconds("90")).toBe(90);
    expect(seconds(" ")).toBe(900);
  });

  it("reads numbers, flags and lists", () => {
    const parsed = cfg({
      PORT: "8080",
      TRUST_PROXY: "2",
      REFRESH_TOKEN_TTL_DAYS: "7",
      COOKIE_SECURE: "true",
      RATE_LIMIT_MAX: "50",
      CORS_ORIGINS: " https://a.example.test, ,https://b.example.test ",
      LOG_LEVEL: "warn",
      LOG_PRETTY: "true",
      METRICS_ENABLED: "true",
      METRICS_TOKEN: "t",
      REDIS_KEY_PREFIX: "app:",
    });
    expect(parsed.port).toBe(8080);
    expect(parsed.trustProxy).toBe(2);
    expect(parsed.auth.refreshTokenTtlDays).toBe(7);
    expect(parsed.auth.cookieSecure).toBe(true);
    expect(parsed.rateLimit.general).toBe(50);
    expect(parsed.corsOrigins).toEqual([
      "https://a.example.test",
      "https://b.example.test",
    ]);
    expect(parsed.log).toEqual({ level: "warn", pretty: true });
    expect(parsed.metrics).toEqual({ enabled: true, token: "t" });
    expect(parsed.redis.keyPrefix).toBe("app:");
  });

  it("never allows a wildcard origin", () => {
    expect(
      cfg({ CORS_ORIGINS: "*, https://a.example.test" }).corsOrigins
    ).toEqual(["https://a.example.test"]);
    expect(cfg({ CORS_ORIGINS: "*" }).corsOrigins).toEqual([]);
  });

  it("caps the lifetime of signed media links at one hour", () => {
    expect(cfg({ MEDIA_URL_TTL_SECONDS: "60" }).mediaUrlTtlSeconds).toBe(60);
    expect(cfg({ MEDIA_URL_TTL_SECONDS: "999999" }).mediaUrlTtlSeconds).toBe(
      3600
    );
  });

  it("turns indexing and docs on, except in production", () => {
    for (const key of ["mongoAutoIndex", "docsEnabled"]) {
      expect(cfg({})[key]).toBe(true);
      expect(cfg({ NODE_ENV: "test" })[key]).toBe(true);
      expect(cfg({ NODE_ENV: "production" })[key]).toBe(false);
    }
    expect(
      cfg({ NODE_ENV: "production", MONGO_AUTO_INDEX: "true" }).mongoAutoIndex
    ).toBe(true);
    expect(
      cfg({ NODE_ENV: "production", DOCS_ENABLED: "true" }).docsEnabled
    ).toBe(true);
    expect(
      cfg({ NODE_ENV: "development", MONGO_AUTO_INDEX: "false" }).mongoAutoIndex
    ).toBe(false);
    expect(cfg({ NODE_ENV: "test", DOCS_ENABLED: "false" }).docsEnabled).toBe(
      false
    );
  });

  it("falls back to defaults for invalid values instead of throwing", () => {
    const parsed = cfg({
      PORT: "nope",
      ACCESS_TOKEN_TTL: "soon",
      LOG_LEVEL: "loud",
    });
    expect(parsed.port).toBe(5000);
    expect(parsed.auth.accessTokenTtlSeconds).toBe(900);
    expect(parsed.log.level).toBe("info");
  });

  it("lists every variable once", () => {
    expect(ENV_VARIABLES.length).toBe(new Set(ENV_VARIABLES).size);
    expect(ENV_VARIABLES).toEqual(
      expect.arrayContaining([
        "MONGO_URI",
        "JWT_SECRET",
        "LOG_LEVEL",
        "LOG_PRETTY",
        "METRICS_ENABLED",
        "METRICS_TOKEN",
      ])
    );
  });
});

describe("environment access", () => {
  const skip = new Set(["node_modules", "tests", ".git", "coverage", "docs"]);
  const files = (dir) =>
    readdirSync(dir).flatMap((name) => {
      if (skip.has(name)) return [];
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return files(full);
      return name.endsWith(".js") ? [full] : [];
    });

  it("only happens in the config module", () => {
    const offenders = files(root)
      .filter((file) => !file.endsWith(path.join("config", "index.js")))
      .filter((file) => /process\.env/.test(readFileSync(file, "utf8")))
      .map((file) => toPosix(path.relative(root, file)));
    expect(offenders).toEqual([]);
  });
});

describe("TRUST_PROXY", () => {
  const trust = (value) => cfg({ TRUST_PROXY: value }).trustProxy;

  it("accepts a hop count", () => {
    expect(trust("")).toBe(0);
    expect(trust("0")).toBe(0);
    expect(trust("1")).toBe(1);
    expect(trust("2")).toBe(2);
  });

  it("accepts a list of proxy addresses, subnets and names", () => {
    expect(trust("loopback")).toBe("loopback");
    expect(trust("10.0.0.0/8, 192.168.1.10")).toBe("10.0.0.0/8, 192.168.1.10");
    expect(trust(" 10.0.0.0/8 ,loopback ")).toBe("10.0.0.0/8, loopback");
    expect(trust("fd00::/8")).toBe("fd00::/8");
  });

  it("accepts true and false", () => {
    expect(trust("true")).toBe(true);
    expect(trust("false")).toBe(0);
  });

  it.each([
    "yes",
    "-1",
    "1.5",
    "10.0.0.0/33",
    "300.1.1.1",
    "loopback, nope",
    "10.0.0.0/x",
    "10.0.0.0/8/8",
  ])("refuses %s and reports it", (value) => {
    expect(getEnvProblems({ ...base, TRUST_PROXY: value })).toEqual([
      "TRUST_PROXY must be a number of proxy hops or a list of proxy addresses or subnets",
    ]);
  });

  it("warns about a bare true, and about nothing else", () => {
    const warnings = getConfigWarnings(cfg({ TRUST_PROXY: "true" }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("TRUST_PROXY=true");
    for (const value of ["", "0", "1", "loopback", "10.0.0.0/8", "false"]) {
      expect(getConfigWarnings(cfg({ TRUST_PROXY: value }))).toEqual([]);
    }
  });
});
