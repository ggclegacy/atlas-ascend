import { ImageResponse } from "next/og";

/**
 * App icon, generated at build time.
 *
 * Generated rather than checked in as a binary so the mark stays in sync with
 * the design system — the gold ramp here is the same one the app uses, and a
 * change to it cannot leave a stale PNG behind.
 *
 * Composition: the ascending chevrons on obsidian, with the gold ramp running
 * across them. Maskable-safe — the mark sits well inside the 80% safe circle,
 * so Android's aggressive icon cropping never clips it.
 */

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(circle at 50% 38%, #1B1030 0%, #08080B 55%, #000000 100%)",
        }}
      >
        <svg width="300" height="300" viewBox="0 0 26 26">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#664b18" />
              <stop offset="28%" stopColor="#956e24" />
              <stop offset="46%" stopColor="#c4912f" />
              <stop offset="52%" stopColor="#f6e7be" />
              <stop offset="58%" stopColor="#deb25e" />
              <stop offset="76%" stopColor="#956e24" />
              <stop offset="100%" stopColor="#664b18" />
            </linearGradient>
          </defs>
          <path
            d="M4 12 L13 4 L22 12"
            fill="none"
            stroke="url(#g)"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7.5 21.5 L13 16.5 L18.5 21.5"
            fill="none"
            stroke="url(#g)"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.5"
          />
        </svg>
      </div>
    ),
    size,
  );
}
