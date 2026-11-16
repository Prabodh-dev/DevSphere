import { describe, it, expect, vi, beforeEach } from "vitest";

const send = vi.fn().mockResolvedValue({});
vi.mock("../utils/s3.js", () => ({ default: { send } }));

const { uploadToS3 } = await import("../utils/s3Utils.js");

describe("uploadToS3", () => {
  beforeEach(() => {
    send.mockClear();
    process.env.AVATAR_BUCKET = "example-bucket";
    process.env.AWS_REGION = "eu-west-1";
  });

  it("loads without an external uuid package and builds a unique key", async () => {
    const url = await uploadToS3(Buffer.from("x"), "me.png", "image/png");

    const params = send.mock.calls[0][0].input;
    expect(params.Bucket).toBe("example-bucket");
    expect(params.ContentType).toBe("image/png");
    expect(params.Key).toMatch(/^avatars\/[0-9a-f-]{36}-me\.png$/);
    expect(url).toBe(
      `https://example-bucket.s3.eu-west-1.amazonaws.com/${params.Key}`
    );
  });
});
