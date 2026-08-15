import { ImageResponse } from "next/og";

/**
 * iOS home-screen icon.
 *
 * Separate from `icon.tsx` because iOS does not apply a mask and renders the
 * square as-is with its own rounding. The mark is therefore proportionally
 * larger here — sizing it for Android's maskable safe zone would look
 * needlessly small on an iPhone home screen.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
            "radial-gradient(circle at 50% 36%, #1B1030 0%, #08080B 58%, #000000 100%)",
        }}
      >
        <svg width="124" height="124" viewBox="0 0 26 26">
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
