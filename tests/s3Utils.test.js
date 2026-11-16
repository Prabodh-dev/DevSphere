import { describe, it, expect, vi, beforeEach } from "vitest";
import { png, html } from "./helpers/files.js";

const send = vi.hoisted(() => vi.fn());
vi.mock("../utils/s3.js", () => ({ default: { send } }));

const { uploadMedia, getSignedMediaUrl, deleteMedia } =
  await import("../utils/s3Utils.js");

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({});
  process.env.AVATAR_BUCKET = "example-bucket";
  delete process.env.MEDIA_URL_TTL_SECONDS;
});

describe("uploadMedia", () => {
  it("stores the file under a generated key and returns the key", async () => {
    const key = await uploadMedia({
      buffer: png(),
      mimetype: "image/png",
      prefix: "avatars",
    });

    expect(key).toMatch(/^avatars\/[0-9a-f-]{36}\.png$/);
    const [command] = send.mock.calls[0];
    expect(command.input).toMatchObject({
      Bucket: "example-bucket",
      Key: key,
      ContentType: "image/png",
    });
    // No ACL: objects stay private.
    expect(command.input.ACL).toBeUndefined();
  });

  it("refuses content that does not match the declared type", async () => {
    await expect(
      uploadMedia({ buffer: html(), mimetype: "image/png", prefix: "avatars" })
    ).rejects.toMatchObject({ status: 400 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("getSignedMediaUrl", () => {
  beforeEach(() => {
    process.env.AWS_REGION = "eu-west-1";
  });

  it("returns an empty string when there is no key", async () => {
    expect(await getSignedMediaUrl("")).toBe("");
    expect(await getSignedMediaUrl(undefined)).toBe("");
  });
});

describe("deleteMedia", () => {
  it("deletes the object", async () => {
    expect(await deleteMedia("status/abc.png")).toBe(true);
    const [command] = send.mock.calls[0];
    expect(command.input).toMatchObject({
      Bucket: "example-bucket",
      Key: "status/abc.png",
    });
  });

  it("reports failure instead of throwing", async () => {
    send.mockRejectedValueOnce(new Error("denied"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await deleteMedia("status/abc.png")).toBe(false);
    warn.mockRestore();
  });

  it("ignores empty keys", async () => {
    expect(await deleteMedia("")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
