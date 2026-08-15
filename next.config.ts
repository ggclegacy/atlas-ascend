import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Note: mapbox-gl is deliberately NOT listed in `serverExternalPackages`.
  // It is already browser-only — loaded via a dynamic `import()` inside a
  // client component — so it never reaches the server bundle. Marking it
  // external additionally breaks the `mapbox-gl/dist/mapbox-gl.css` import,
  // because externals may only resolve to JS-like files.

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Geolocation and microphone are core to the product and must stay
          // permitted for this origin. Everything else is denied by default.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), microphone=(self), camera=(self), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
