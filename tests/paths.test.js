import { describe, it, expect } from "vitest";
import path from "path";
import { toPosix } from "./helpers/paths.js";

describe("toPosix", () => {
  it("turns Windows separators into forward slashes", () => {
    expect(toPosix("config\\redis.js")).toBe("config/redis.js");
    expect(toPosix(path.win32.join("tests", "helpers", "redis.js"))).toBe(
      "tests/helpers/redis.js"
    );
    expect(
      toPosix(path.win32.relative("C:\\app", "C:\\app\\config\\redis.js"))
    ).toBe("config/redis.js");
  });

  it("leaves forward slashes alone", () => {
    expect(toPosix("config/redis.js")).toBe("config/redis.js");
  });
});
