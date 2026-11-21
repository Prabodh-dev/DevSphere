import { describe, it, expect } from "vitest";
import { detectMime } from "../utils/fileType.js";
import { png, jpeg, gif, mp4, html, pdf, zip } from "./helpers/files.js";

describe("detectMime", () => {
  it("recognises the supported formats from their bytes", () => {
    expect(detectMime(png())).toBe("image/png");
    expect(detectMime(jpeg())).toBe("image/jpeg");
    expect(detectMime(gif())).toBe("image/gif");
    expect(detectMime(mp4())).toBe("video/mp4");

    const webp = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([1, 2, 3, 4]),
      Buffer.from("WEBPVP8 "),
    ]);
    expect(detectMime(webp)).toBe("image/webp");

    const webm = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.alloc(16),
    ]);
    expect(detectMime(webm)).toBe("video/webm");

    const mov = Buffer.concat([
      Buffer.from([0, 0, 0, 20]),
      Buffer.from("ftypqt  "),
      Buffer.alloc(8),
    ]);
    expect(detectMime(mov)).toBe("video/quicktime");
  });

  it("recognises PDF and ZIP files", () => {
    expect(detectMime(pdf())).toBe("application/pdf");
    expect(detectMime(zip())).toBe("application/zip");
    const empty = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x05, 0x06]),
      Buffer.alloc(18),
    ]);
    expect(detectMime(empty)).toBe("application/zip");
  });

  it("returns null for anything else", () => {
    expect(detectMime(html())).toBeNull();
    expect(detectMime(Buffer.from("tiny"))).toBeNull();
    expect(detectMime("not a buffer")).toBeNull();
  });
});
