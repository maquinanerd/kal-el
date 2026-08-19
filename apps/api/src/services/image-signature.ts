/**
 * Magic-byte detection for the raster formats Kal El accepts.
 *
 * The upload path previously trusted `part.mimetype` - a header the client writes - and
 * `image-size` swallowed every failure, so an arbitrary payload declared as `image/png`
 * was stored and served from the trusted API origin. `X-Content-Type-Options: nosniff`
 * plus the pinned response type stop it becoming stored XSS, but it remains arbitrary
 * content hosting and an AV/DLP bypass.
 *
 * Detection reads a handful of leading bytes; no decoder runs on untrusted input.
 */
export type DetectedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif";

function ascii(buf: Buffer, start: number, length: number): string {
  return buf.subarray(start, start + length).toString("latin1");
}

/** ISO-BMFF brands that are AVIF images (not sequences/video). */
const AVIF_BRANDS = new Set(["avif", "avis", "mif1", "miaf"]);

export function detectImageType(buf: Buffer): DetectedImageType | null {
  if (buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF: "GIF87a" or "GIF89a"
  const gif = ascii(buf, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";

  // WEBP: "RIFF" ....  "WEBP"
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") return "image/webp";

  // AVIF: ISO-BMFF, "ftyp" at offset 4 followed by a brand
  if (ascii(buf, 4, 4) === "ftyp" && AVIF_BRANDS.has(ascii(buf, 8, 4).toLowerCase())) {
    return "image/avif";
  }

  return null;
}

/**
 * JPEG and its variants are the one case where the declared type and a reasonable
 * detection can legitimately differ in spelling.
 */
export function typesMatch(declared: string, detected: DetectedImageType): boolean {
  const normalise = (t: string) => (t === "image/jpg" ? "image/jpeg" : t);
  return normalise(declared) === detected;
}
