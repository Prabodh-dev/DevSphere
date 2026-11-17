import { describe, it, expect } from "vitest";
import { withEnv } from "./helpers/config.js";

// Uses the real presigner with the obviously fake credentials from
// tests/setup.js; signing is local.
const { getSignedMediaUrl } = await import("../utils/s3Utils.js");

describe("signed media URLs", () => {
  it("point at the private bucket and expire after five minutes by default", async () => {
    const url = new URL(await getSignedMediaUrl("avatars/abc.png"));
    expect(url.hostname).toBe("example-bucket.s3.eu-west-1.amazonaws.com");
    expect(url.pathname).toBe("/avatars/abc.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("uses the configured lifetime, capped at one hour", async () => {
    await withEnv({ MEDIA_URL_TTL_SECONDS: "60" }, async () => {
      const url = new URL(await getSignedMediaUrl("a/b.png"));
      expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    });
    await withEnv({ MEDIA_URL_TTL_SECONDS: "999999" }, async () => {
      const url = new URL(await getSignedMediaUrl("a/b.png"));
      expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    });
  });
});
