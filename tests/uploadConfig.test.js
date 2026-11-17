import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import request from "supertest";
import app from "../app.js";
import { getS3Client, isUploadConfigured, resetS3Client } from "../utils/s3.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer } from "./helpers/users.js";
import { png } from "./helpers/files.js";
import { withEnv } from "./helpers/config.js";

const blank = {
  AWS_ACCESS_KEY: "",
  AWS_SECRET_KEY: "",
  AWS_REGION: "",
  AVATAR_BUCKET: "",
};

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(clearTestDb);
afterEach(resetS3Client);

describe("S3 client", () => {
  it("is not created until it is needed, even with every setting blank", async () => {
    await withEnv(blank, () => {
      resetS3Client();
      expect(isUploadConfigured()).toBe(false);
      expect(() => getS3Client()).not.toThrow();
    });
  });

  it("uses a default region when AWS_REGION is blank or unset", async () => {
    await withEnv({ AWS_REGION: "" }, async () => {
      resetS3Client();
      expect(await getS3Client().config.region()).toBe("us-east-1");
    });
    await withEnv({ AWS_REGION: undefined }, async () => {
      resetS3Client();
      expect(await getS3Client().config.region()).toBe("us-east-1");
    });
  });

  it("uses the configured region", async () => {
    await withEnv({ AWS_REGION: "eu-west-1" }, async () => {
      resetS3Client();
      expect(await getS3Client().config.region()).toBe("eu-west-1");
    });
  });
});

describe("uploads without configuration", () => {
  it("answer 503 with a clear message when a file is uploaded", async () => {
    const user = await createUser();

    await withEnv(blank, async () => {
      resetS3Client();
      const avatar = await request(app)
        .post("/api/v1/profile")
        .set(bearer(user.token))
        .attach("avatar", png(), {
          filename: "a.png",
          contentType: "image/png",
        });
      expect(avatar.status).toBe(503);
      expect(avatar.body).toEqual({
        error: {
          code: "UPLOADS_NOT_CONFIGURED",
          message: "File uploads are not configured",
        },
      });

      const status = await request(app)
        .post("/api/v1/status")
        .set(bearer(user.token))
        .field("type", "image")
        .attach("media", png(), {
          filename: "a.png",
          contentType: "image/png",
        });
      expect(status.status).toBe(503);
    });
  });

  it("do not affect requests that do not upload anything", async () => {
    const user = await createUser();

    await withEnv(blank, async () => {
      resetS3Client();
      const profile = await request(app)
        .post("/api/v1/profile")
        .set(bearer(user.token))
        .send({ bio: "no avatar here" });
      expect(profile.status).toBe(200);
      expect(profile.body.avatar).toBe("");

      const text = await request(app)
        .post("/api/v1/status")
        .set(bearer(user.token))
        .send({ type: "text", content: "hello" });
      expect(text.status).toBe(201);

      const feed = await request(app)
        .get("/api/v1/status/feed")
        .set(bearer(user.token));
      expect(feed.status).toBe(200);
    });
  });
});
