import { describe, expect, it } from "vitest";
import { detectImageType, typesMatch } from "../src/services/image-signature.js";

/**
 * P1-I. The upload path trusted `part.mimetype`, a header the client writes, and
 * `readDimensions` swallowed every failure - so any payload declared `image/png` was
 * stored and served from the trusted API origin.
 */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 0),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 0)]);
const GIF89 = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(16, 0)]);
const GIF87 = Buffer.concat([Buffer.from("GIF87a", "latin1"), Buffer.alloc(16, 0)]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "latin1"),
  Buffer.alloc(16, 0),
]);
const AVIF = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x20]),
  Buffer.from("ftypavif", "latin1"),
  Buffer.alloc(16, 0),
]);

// Windows PE header - the classic "rename it .png" payload
const EXE = Buffer.concat([Buffer.from("MZ", "latin1"), Buffer.alloc(64, 0)]);
const HTML = Buffer.from("<!doctype html><script>alert(1)</script>          ", "latin1");
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>', "latin1");

describe("image signature detection", () => {
  it("identifies a format from the minimum bytes it needs", () => {
    // a JPEG is identifiable from 3 bytes; requiring a blanket 12 rejected small files
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]))).toBe("image/jpeg");
    expect(detectImageType(Buffer.from("GIF89a", "latin1"))).toBe("image/gif");
  });

  it("recognises every accepted raster format", () => {
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(GIF89)).toBe("image/gif");
    expect(detectImageType(GIF87)).toBe("image/gif");
    expect(detectImageType(WEBP)).toBe("image/webp");
    expect(detectImageType(AVIF)).toBe("image/avif");
  });

  it("refuses anything that is not one of them", () => {
    expect(detectImageType(EXE)).toBeNull();
    expect(detectImageType(HTML)).toBeNull();
    // SVG stays out: it is a scriptable document, not a raster image
    expect(detectImageType(SVG)).toBeNull();
    expect(detectImageType(Buffer.alloc(64, 0))).toBeNull();
    expect(detectImageType(Buffer.alloc(2, 0xff)), "too short to identify anything").toBeNull();
    // a RIFF header truncated before the WEBP marker must not be guessed at
    expect(detectImageType(Buffer.from("RIFF1234", "latin1"))).toBeNull();
  });

  it("does not confuse a RIFF container that is not WEBP", () => {
    const wav = Buffer.concat([
      Buffer.from("RIFF", "latin1"),
      Buffer.from([0x20, 0x00, 0x00, 0x00]),
      Buffer.from("WAVE", "latin1"),
      Buffer.alloc(16, 0),
    ]);
    expect(detectImageType(wav)).toBeNull();
  });

  it("does not accept a non-image ISO-BMFF brand as AVIF", () => {
    const mp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from("ftypmp42", "latin1"),
      Buffer.alloc(16, 0),
    ]);
    expect(detectImageType(mp4)).toBeNull();
  });

  it("matches declared against detected, tolerating the image/jpg spelling", () => {
    expect(typesMatch("image/png", "image/png")).toBe(true);
    expect(typesMatch("image/jpeg", "image/jpeg")).toBe(true);
    expect(typesMatch("image/jpg", "image/jpeg")).toBe(true);
    expect(typesMatch("image/png", "image/jpeg")).toBe(false);
    expect(typesMatch("image/webp", "image/gif")).toBe(false);
  });
});
