import type { Metadata } from "next";
import { MapboxLab } from "@/features/debug/MapboxLab";

/**
 * `/debug/mapbox` — Mapbox isolation harness.
 *
 * NOT part of the product. Unlinked from every product surface and excluded
 * from indexing. It exists so a black map can be attributed to a specific
 * layer instead of guessed at.
 *
 * Deliberately reachable in production: the failure being diagnosed only
 * reproduces on the deployed environment, so a development-only tool would be
 * useless for it. It exposes no secrets — the token is reported by presence,
 * length, and prefix only.
 */
export const metadata: Metadata = {
  title: "Mapbox isolation · Atlas Ascend",
  robots: { index: false, follow: false },
};

export default function DebugMapboxPage() {
  return <MapboxLab />;
}
