"use client";

import { Component, type ReactNode } from "react";

/**
 * Isolates the map from the rest of the Command Center.
 *
 * The map is the environmental layer, not the application. A WebGL failure, a
 * vendor SDK exception, or a bad style must degrade that layer only — it must
 * never take down the vehicle chip, the destination rail, or Atlas. Without a
 * boundary here, one throw inside the map subtree unmounts the entire page and
 * leaves a black screen, which is indistinguishable from the exact bug being
 * investigated.
 *
 * Renders nothing on failure: `MapSurface` already owns the designed
 * "MAP UNAVAILABLE" state, and the obsidian canvas behind it is the correct
 * fallback for a missing environmental layer.
 */
export class MapErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    // Always logged, regardless of debug mode — an exception that reaches here
    // is never routine.
    console.error("[AtlasMap] map subtree threw; Command Center preserved", error);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div
          className="absolute inset-0 bg-obsidian"
          aria-label="Map unavailable"
          role="img"
        />
      );
    }
    return this.props.children;
  }
}
