import { describe, expect, it } from "vitest";
import {
  type Coordinate,
  DEFAULT_CAMERA,
  PERSPECTIVES,
  bearingDegrees,
  distanceMeters,
  formatMiles,
  isValidCamera,
  isValidCoordinate,
  metersPerSecondToMph,
  metersToMiles,
  pitchFor,
} from "@/map/types";

const AUSTIN: Coordinate = { latitude: 30.2672, longitude: -97.7431 };
const DALLAS: Coordinate = { latitude: 32.7767, longitude: -96.797 };

describe("map geometry", () => {
  it("measures a known distance within a tolerance", () => {
    // Austin to Dallas is ~293 km great-circle.
    const km = distanceMeters(AUSTIN, DALLAS) / 1000;
    expect(km).toBeGreaterThan(285);
    expect(km).toBeLessThan(300);
  });

  it("returns zero distance for identical points", () => {
    expect(distanceMeters(AUSTIN, AUSTIN)).toBeCloseTo(0, 6);
  });

  it("computes bearing in the 0-360 range", () => {
    const bearing = bearingDegrees(AUSTIN, DALLAS);
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
    // Dallas is roughly north-northeast of Austin.
    expect(bearing).toBeGreaterThan(0);
    expect(bearing).toBeLessThan(90);
  });

  it("rejects out-of-range coordinates", () => {
    expect(isValidCoordinate({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isValidCoordinate({ latitude: NaN, longitude: 0 })).toBe(false);
    expect(isValidCoordinate(AUSTIN)).toBe(true);
  });

  it("converts speed from m/s to mph", () => {
    expect(metersPerSecondToMph(0)).toBe(0);
    // 26.8 m/s is ~60 mph.
    expect(metersPerSecondToMph(26.8224)).toBe(60);
  });

  it("converts meters to miles", () => {
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 6);
  });

  it("formats short distances in tenths and long ones as whole miles", () => {
    expect(formatMiles(1609.344)).toBe("1.0");
    expect(formatMiles(1609.344 * 42)).toBe("42");
  });
});

describe("default camera", () => {
  it("is a valid, renderable camera", () => {
    expect(isValidCamera(DEFAULT_CAMERA)).toBe(true);
  });

  it("uses a usable navigation zoom, not a world or building view", () => {
    // A first-time user who denies location must still see recognizable
    // geography, not an ocean or a single rooftop.
    expect(DEFAULT_CAMERA.zoom).toBeGreaterThan(10);
    expect(DEFAULT_CAMERA.zoom).toBeLessThan(19);
  });

  it("does not sit at null island", () => {
    // 0,0 is the signature of a coordinate that was never set — and it is in
    // the Atlantic, which looks exactly like a broken map.
    expect(Math.abs(DEFAULT_CAMERA.center.latitude)).toBeGreaterThan(1);
    expect(Math.abs(DEFAULT_CAMERA.center.longitude)).toBeGreaterThan(1);
  });

  it("keeps latitude and longitude the right way round", () => {
    // Austin is ~30°N, ~97°W. A lat/lon swap would put latitude at -97, which
    // is out of range — the classic silent geo bug.
    expect(DEFAULT_CAMERA.center.latitude).toBeGreaterThan(25);
    expect(DEFAULT_CAMERA.center.latitude).toBeLessThan(35);
    expect(DEFAULT_CAMERA.center.longitude).toBeLessThan(-90);
  });

  it("rejects impossible cameras", () => {
    expect(isValidCamera({ ...DEFAULT_CAMERA, zoom: NaN })).toBe(false);
    expect(isValidCamera({ ...DEFAULT_CAMERA, zoom: 40 })).toBe(false);
    expect(isValidCamera({ ...DEFAULT_CAMERA, pitch: 120 })).toBe(false);
    expect(
      isValidCamera({
        ...DEFAULT_CAMERA,
        center: { latitude: -97.7431, longitude: 30.2672 },
      }),
      "a lat/lon swap must not validate",
    ).toBe(false);
  });
});

describe("map perspectives", () => {
  it("pitches the driving camera and flattens overview", () => {
    expect(pitchFor("driving")).toBeGreaterThan(45);
    expect(pitchFor("oriented")).toBeGreaterThan(0);
    expect(pitchFor("overview")).toBe(0);
  });

  it("cycles through every perspective and wraps to the start", () => {
    const seen = new Set<string>();
    let current = PERSPECTIVES[0] as string;

    for (let i = 0; i < PERSPECTIVES.length; i++) {
      seen.add(current);
      const index = PERSPECTIVES.indexOf(current as (typeof PERSPECTIVES)[number]);
      current = PERSPECTIVES[(index + 1) % PERSPECTIVES.length] as string;
    }

    expect(seen.size).toBe(PERSPECTIVES.length);
    expect(current).toBe(PERSPECTIVES[0]);
  });
});
