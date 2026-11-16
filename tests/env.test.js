import { describe, it, expect } from "vitest";
import { getMissingEnv } from "../config/env.js";

describe("getMissingEnv", () => {
  it("lists missing and blank required variables", () => {
    expect(getMissingEnv({})).toEqual(["MONGO_URI", "JWT_SECRET"]);
    expect(getMissingEnv({ MONGO_URI: "  ", JWT_SECRET: "x" })).toEqual([
      "MONGO_URI",
    ]);
  });

  it("returns nothing when everything is set", () => {
    expect(getMissingEnv({ MONGO_URI: "m", JWT_SECRET: "s" })).toEqual([]);
  });
});
