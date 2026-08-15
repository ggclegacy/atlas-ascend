import type { MetadataRoute } from "next";

/**
 * PWA manifest.
 *
 * `display: "standalone"` is what removes browser chrome once the app is added
 * to the home screen — the single largest step toward the delivery technology
 * disappearing.
 *
 * Deliberately minimal: no offline strategy, no service worker yet. An offline
 * shell for a live-map navigation product is mostly theater, and a badly-scoped
 * service worker is a reliable way to serve users a stale build. That work is
 * deferred until there is genuinely offline-useful content to cache.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Atlas Ascend",
    short_name: "Ascend",
    description:
      "Grand Touring Intelligence. A personal mobility command center for life in motion.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["navigation", "travel", "productivity"],
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
