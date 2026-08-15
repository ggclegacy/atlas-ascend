import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas Ascend",
  description:
    "Grand Touring Intelligence. Navigate, optimize, ascend — a personal mobility command center.",
  applicationName: "Atlas Ascend",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Ascend",
    // `black-translucent` is what lets the map run under the status bar. With
    // any other value iOS reserves an opaque strip and the full-bleed map —
    // the core of the product's identity — is impossible.
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    // Stops iOS from turning addresses and numbers in the UI into blue links.
    telephone: false,
    address: false,
    date: false,
  },
  // `mobile-web-app-capable` is emitted automatically from `appleWebApp.capable`
  // above — declaring it again here produces a duplicate meta tag.
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // A driving surface must not pinch-zoom out from under the user. iOS Safari
  // still honors accessibility zoom regardless of this flag.
  userScalable: false,
  // Required for `env(safe-area-inset-*)` to report real values — without it
  // the map cannot extend into the notch and home-indicator regions.
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
