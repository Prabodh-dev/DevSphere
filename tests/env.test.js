import { describe, it, expect } from "vitest";
import {
  getAccessTokenTtlSeconds,
  getCorsOrigins,
  getDocsEnabled,
  getEnvProblems,
  getRefreshTtlDays,
  getTrustProxy,
  isCookieSecure,
} from "../config/env.js";

const LONG_SECRET = "x".repeat(32);

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
    expect(getEnvProblems({ MONGO_URI: "m", JWT_SECRET: LONG_SECRET })).toEqual(
      []
    );
  });
});

describe("getCorsOrigins", () => {
  it("splits a comma separated list and ignores blanks", () => {
    expect(
      getCorsOrigins({
        CORS_ORIGINS: " https://a.example.test, ,https://b.example.test ",
      })
    ).toEqual(["https://a.example.test", "https://b.example.test"]);
  });

  it("is empty when unset and never contains a wildcard", () => {
    expect(getCorsOrigins({})).toEqual([]);
    expect(
      getCorsOrigins({ CORS_ORIGINS: "*, https://a.example.test" })
    ).toEqual(["https://a.example.test"]);
  });
});

describe("auth settings", () => {
  const base = { MONGO_URI: "m", JWT_SECRET: LONG_SECRET };

  it("have defaults", () => {
    expect(getAccessTokenTtlSeconds({})).toBe(15 * 60);
    expect(getRefreshTtlDays({})).toBe(30);
    expect(getTrustProxy({})).toBe(0);
    expect(isCookieSecure({})).toBe(false);
  });

  it("read durations in seconds, minutes, hours and days", () => {
    expect(getAccessTokenTtlSeconds({ ACCESS_TOKEN_TTL: "30s" })).toBe(30);
    expect(getAccessTokenTtlSeconds({ ACCESS_TOKEN_TTL: "10m" })).toBe(600);
    expect(getAccessTokenTtlSeconds({ ACCESS_TOKEN_TTL: "2h" })).toBe(7200);
    expect(getAccessTokenTtlSeconds({ ACCESS_TOKEN_TTL: "1d" })).toBe(86400);
    expect(getAccessTokenTtlSeconds({ ACCESS_TOKEN_TTL: "90" })).toBe(90);
  });

  it("read the other values", () => {
    expect(getRefreshTtlDays({ REFRESH_TOKEN_TTL_DAYS: "7" })).toBe(7);
    expect(getTrustProxy({ TRUST_PROXY: "2" })).toBe(2);
    expect(isCookieSecure({ COOKIE_SECURE: "true" })).toBe(true);
    expect(isCookieSecure({ COOKIE_SECURE: "false" })).toBe(false);
  });

  it("treat blank values as unset", () => {
    expect(getAccessTokenTtlSeconds({ ACCESS_TOKEN_TTL: " " })).toBe(900);
    expect(getRefreshTtlDays({ REFRESH_TOKEN_TTL_DAYS: "" })).toBe(30);
    expect(getTrustProxy({ TRUST_PROXY: "" })).toBe(0);
  });

  it("report invalid values at startup", () => {
    expect(getEnvProblems({ ...base, ACCESS_TOKEN_TTL: "soon" })).toEqual([
      "ACCESS_TOKEN_TTL must look like 30s, 15m, 2h or 1d",
    ]);
    expect(getEnvProblems({ ...base, ACCESS_TOKEN_TTL: "0m" })).toHaveLength(1);
    expect(getEnvProblems({ ...base, REFRESH_TOKEN_TTL_DAYS: "0" })).toEqual([
      "REFRESH_TOKEN_TTL_DAYS must be a positive whole number",
    ]);
    expect(getEnvProblems({ ...base, TRUST_PROXY: "yes" })).toEqual([
      "TRUST_PROXY must be a whole number of proxy hops",
    ]);
    expect(getEnvProblems({ ...base, COOKIE_SECURE: "maybe" })).toEqual([
      "COOKIE_SECURE must be true or false",
    ]);
    expect(
      getEnvProblems({
        ...base,
        ACCESS_TOKEN_TTL: "15m",
        REFRESH_TOKEN_TTL_DAYS: "30",
        TRUST_PROXY: "1",
        COOKIE_SECURE: "true",
      })
    ).toEqual([]);
  });
});

describe("DOCS_ENABLED", () => {
  it("defaults to on, except in production", () => {
    expect(getDocsEnabled({})).toBe(true);
    expect(getDocsEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(getDocsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(
      getDocsEnabled({ NODE_ENV: "production", DOCS_ENABLED: "true" })
    ).toBe(true);
    expect(getDocsEnabled({ NODE_ENV: "test", DOCS_ENABLED: "false" })).toBe(
      false
    );
  });

  it("is checked at startup", () => {
    const base = { MONGO_URI: "m", JWT_SECRET: "x".repeat(32) };
    expect(getEnvProblems({ ...base, DOCS_ENABLED: "maybe" })).toEqual([
      "DOCS_ENABLED must be true or false",
    ]);
  });
});
