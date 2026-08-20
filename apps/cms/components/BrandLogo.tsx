import type { CSSProperties } from "react";

const SIZES = { md: 26, lg: 40 } as const;

/**
 * The Kal El lockup: the comic-panel mark plus the "cms Kal-el" wordmark.
 *
 * The wordmark ships as a black-on-transparent PNG and is painted through a CSS mask
 * (`.peg-logo__wordmark`), so it follows the text colour into dark mode - a plain <img>
 * of black glyphs would disappear against the dark sidebar. The mark stays an <img>
 * because it is full-colour artwork; it is decorative, since the wordmark already
 * carries the product name for assistive tech.
 */
export function BrandLogo({ size = "md" }: { size?: keyof typeof SIZES }) {
  const px = SIZES[size];
  return (
    <span
      className={`peg-logo${size === "lg" ? " peg-logo--lg" : ""}`}
      style={{ "--peg-logo-wordmark": "url(/brand/kal-el-wordmark.png)" } as CSSProperties}
    >
      <img className="peg-logo__mark" src="/brand/kal-el-mark.png" alt="" width={px} height={px} />
      <span className="peg-logo__wordmark" role="img" aria-label="CMS Kal-El" />
    </span>
  );
}
