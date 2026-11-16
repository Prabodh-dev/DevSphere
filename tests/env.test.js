import { describe, it, expect } from "vitest";
import { getEnvProblems, getCorsOrigins } from "../config/env.js";

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
