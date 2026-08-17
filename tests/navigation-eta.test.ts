import { describe, expect, it } from "vitest";
import {
  compareToFastest,
  describeDelay,
  estimateArrival,
  formatArrivalClock,
  formatDuration,
  formatRouteDistance,
} from "@/navigation/eta";
import {
  ROUTE_OVERVIEW_MAX_ZOOM,
  ROUTE_OVERVIEW_PITCH,
  routePreviewPadding,
} from "@/navigation/framing";
import type { AtlasRoute } from "@/routing/types";

/**
 * Arrival estimates and route framing.
 *
 * The ETA rule is the one thing here a driver will actually plan around, so it
 * is stated in exactly one place and tested at a fixed instant.
 */

const NOON = new Date("2026-08-17T12:00:00Z").getTime();

function route(over: Partial<AtlasRoute> = {}): AtlasRoute {
  return {
    id: "r",
    distanceMeters: 10_000,
    durationSeconds: 1_200,
    typicalDurationSeconds: null,
    geometry: [],
    cumulative: [],
    legs: [],
    bounds: {
      southwest: { latitude: 30, longitude: -98 },
      northeast: { latitude: 31, longitude: -97 },
    },
    voiceLocale: "en-US",
    provider: "test",
    requestedAt: 0,
    ...over,
  };
}

describe("ETA", () => {
  it("is now plus the live duration", () => {
    const estimate = estimateArrival(route({ durationSeconds: 1_800 }), NOON);
    expect(estimate.etaEpochMs).toBe(NOON + 1_800_000);
    expect(estimate.durationSeconds).toBe(1_800);
  });

  it("NEVER uses the typical duration, even when it is present", () => {
    // THE RULE. On the traffic profile `durationSeconds` already accounts for
    // live conditions and `typicalDurationSeconds` is the baseline. Measured
    // on a real response: live 582s against typical 509s. Using the baseline
    // would put arrival more than a minute early precisely when traffic is
    // what makes the ETA matter.
    const heavy = route({ durationSeconds: 582, typicalDurationSeconds: 509 });
    expect(estimateArrival(heavy, NOON).etaEpochMs).toBe(NOON + 582_000);
    expect(estimateArrival(heavy, NOON).etaEpochMs).not.toBe(NOON + 509_000);
  });

  it("reports a delay only when it is worth saying", () => {
    // Both an absolute and a proportional floor: 90 seconds over on a
    // twelve-hour drive is not traffic; 90 seconds over on four minutes is.
    expect(
      estimateArrival(route({ durationSeconds: 700, typicalDurationSeconds: 600 }), NOON)
        .delayVersusTypicalSeconds,
    ).toBe(100);

    // Under the absolute floor.
    expect(
      estimateArrival(route({ durationSeconds: 630, typicalDurationSeconds: 600 }), NOON)
        .delayVersusTypicalSeconds,
    ).toBeNull();

    // Over the absolute floor but a trivial proportion of a long drive.
    expect(
      estimateArrival(
        route({ durationSeconds: 36_090, typicalDurationSeconds: 36_000 }),
        NOON,
      ).delayVersusTypicalSeconds,
    ).toBeNull();
  });

  it("never reports being faster than usual as a delay", () => {
    expect(
      estimateArrival(route({ durationSeconds: 500, typicalDurationSeconds: 600 }), NOON)
        .delayVersusTypicalSeconds,
    ).toBeNull();
  });

  it("survives a missing or nonsense baseline", () => {
    for (const typical of [null, 0, -5, Number.NaN]) {
      const estimate = estimateArrival(
        route({ durationSeconds: 600, typicalDurationSeconds: typical }),
        NOON,
      );
      expect(estimate.delayVersusTypicalSeconds).toBeNull();
      expect(estimate.etaEpochMs).toBe(NOON + 600_000);
    }
  });

  it("phrases a delay in minutes or says nothing", () => {
    expect(
      describeDelay(
        estimateArrival(route({ durationSeconds: 960, typicalDurationSeconds: 600 }), NOON),
      ),
    ).toBe("6 min slower than usual");
    expect(describeDelay(estimateArrival(route(), NOON))).toBeNull();
  });
});

describe("display precision", () => {
  it("never shows seconds", () => {
    // A route is an estimate with minutes of uncertainty. "23 min 41 sec"
    // claims an accuracy that does not exist.
    for (const seconds of [61, 599, 1_234, 3_601, 45_678]) {
      expect(formatDuration(seconds)).not.toMatch(/sec|\bs\b/);
    }
  });

  it("formats durations the way a driver reads them", () => {
    expect(formatDuration(30)).toBe("< 1 min");
    expect(formatDuration(90)).toBe("2 min");
    expect(formatDuration(1_500)).toBe("25 min");
    expect(formatDuration(3_600)).toBe("1 hr");
    expect(formatDuration(5_400)).toBe("1 hr 30 min");
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });

  it("formats distance on the same ladder as the rest of the product", () => {
    expect(formatRouteDistance(50)).toBe("< 0.1 mi");
    expect(formatRouteDistance(1_609.344)).toBe("1.0 mi");
    expect(formatRouteDistance(80_467)).toBe("50 mi");
    expect(formatRouteDistance(Number.NaN)).toBe("—");
  });

  it("renders the arrival clock, not a relative time", () => {
    // The arrival clock is what gets compared against an appointment; the
    // duration is shown separately.
    const text = formatArrivalClock(NOON, "en-US");
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(formatArrivalClock(Number.NaN)).toBe("—");
  });
});

describe("route comparison", () => {
  it("names the fastest and expresses the rest as a trade", () => {
    const fast = route({ id: "a", durationSeconds: 600 });
    const slow = route({ id: "b", durationSeconds: 840 });
    const routes = [fast, slow];

    expect(compareToFastest(fast, routes)).toBe("Fastest");
    expect(compareToFastest(slow, routes)).toBe("+4 min");
  });

  it("calls a lone route the fastest", () => {
    const only = route({ id: "a" });
    expect(compareToFastest(only, [only])).toBe("Fastest");
  });
});

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

const IPHONE = { width: 390, height: 844 };
const NO_SAFE_AREA = { top: 0, bottom: 0, left: 0, right: 0 };

describe("route preview framing", () => {
  it("reserves more room at the bottom, where the sheet is", () => {
    // Centring a route geometrically puts half of it behind its own preview —
    // the most common way this feature is got wrong.
    const padding = routePreviewPadding(IPHONE, 236, NO_SAFE_AREA);
    expect(padding.bottom).toBeGreaterThan(padding.top);
    expect(padding.bottom).toBeGreaterThanOrEqual(236);
  });

  it("leaves clearance so the markers are not clipped", () => {
    // The destination pin extends upward from its coordinate, so it is outside
    // the route bounds by definition. Framing exactly to the bounds cuts it.
    const padding = routePreviewPadding(IPHONE, 0, NO_SAFE_AREA);
    expect(padding.top).toBeGreaterThan(40);
    expect(padding.bottom).toBeGreaterThan(40);
  });

  it("honours device safe areas", () => {
    const notched = routePreviewPadding(IPHONE, 236, {
      top: 59,
      bottom: 34,
      left: 0,
      right: 0,
    });
    const flat = routePreviewPadding(IPHONE, 236, NO_SAFE_AREA);
    expect(notched.top).toBeGreaterThan(flat.top);
    expect(notched.bottom).toBeGreaterThan(flat.bottom);
  });

  it("never demands more room than the viewport has", () => {
    // A tall sheet on a small phone can ask for more padding than there is
    // screen; fitting against a near-zero window produces an absurd zoom and
    // the route vanishes rather than merely being tight.
    for (const viewport of [
      { width: 320, height: 480 },
      { width: 390, height: 844 },
      { width: 280, height: 400 },
    ]) {
      const padding = routePreviewPadding(viewport, 600, {
        top: 59,
        bottom: 34,
        left: 0,
        right: 0,
      });
      expect(padding.top + padding.bottom).toBeLessThan(viewport.height);
      expect(padding.left + padding.right).toBeLessThan(viewport.width);
      for (const edge of Object.values(padding)) {
        expect(edge).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keeps the bottom bias when it has to shrink", () => {
    // Squashing only the bottom would re-centre the route behind the sheet —
    // exactly what the padding exists to prevent.
    const padding = routePreviewPadding({ width: 320, height: 480 }, 600, NO_SAFE_AREA);
    expect(padding.bottom).toBeGreaterThan(padding.top);
  });

  it("caps the overview zoom so a short route stays legible as a journey", () => {
    // A 300m route fits its bounds at building zoom, where both markers
    // overlap and the map shows one intersection.
    expect(ROUTE_OVERVIEW_MAX_ZOOM).toBeLessThan(17);
    expect(ROUTE_OVERVIEW_MAX_ZOOM).toBeGreaterThan(13);
  });

  it("frames flat", () => {
    // Pitch foreshortens the far half and makes a north-south route read
    // shorter than an east-west one of the same length.
    expect(ROUTE_OVERVIEW_PITCH).toBe(0);
  });
});
