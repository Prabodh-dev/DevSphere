import { describe, it, expect, beforeEach } from "vitest";

// Uses the real presigner with obviously fake credentials; signing is local.
process.env.AWS_ACCESS_KEY = "test-access-key-id";
process.env.AWS_SECRET_KEY = "test-secret-access-key";
process.env.AWS_REGION = "eu-west-1";
process.env.AVATAR_BUCKET = "example-bucket";

const { getSignedMediaUrl } = await import("../utils/s3Utils.js");

beforeEach(() => {
  delete process.env.MEDIA_URL_TTL_SECONDS;
});

describe("signed media URLs", () => {
  it("point at the private bucket and expire after five minutes by default", async () => {
    const url = new URL(await getSignedMediaUrl("avatars/abc.png"));
    expect(url.hostname).toBe("example-bucket.s3.eu-west-1.amazonaws.com");
    expect(url.pathname).toBe("/avatars/abc.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("uses the configured lifetime, capped at one hour", async () => {
    process.env.MEDIA_URL_TTL_SECONDS = "60";
    let url = new URL(await getSignedMediaUrl("a/b.png"));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");

    process.env.MEDIA_URL_TTL_SECONDS = "999999";
    url = new URL(await getSignedMediaUrl("a/b.png"));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
  });
});
