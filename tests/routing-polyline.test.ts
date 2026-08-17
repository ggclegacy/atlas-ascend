import { describe, expect, it } from "vitest";
import { PolylineError, decodePolyline } from "@/routing/polyline";
import { distanceMeters } from "@/map/types";

/**
 * Encoded polyline decoding.
 *
 * This is the first thing that touches vendor route data, and everything
 * downstream — the drawn line, progress along it, off-route distance — is
 * wrong in a way nobody would notice if it is subtly wrong here. So it is
 * tested against the format's canonical published fixture, against
 * independently-encoded precision-6 fixtures, and against corrupt input.
 *
 * The precision-6 fixtures below were produced by an independent
 * implementation of the encoding algorithm, not by this decoder — a decoder
 * checked only against its own output proves nothing. That the independent
 * encoder reproduces the published precision-5 fixture byte for byte is what
 * establishes it as trustworthy.
 */

describe("decodePolyline", () => {
  /** (38.5,-120.2), (40.7,-120.95), (43.252,-126.453) */
  const SPEC_POINTS = [
    { latitude: 38.5, longitude: -120.2 },
    { latitude: 40.7, longitude: -120.95 },
    { latitude: 43.252, longitude: -126.453 },
  ];

  it("decodes the canonical precision-5 fixture from the format spec", () => {
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);

    expect(points).toHaveLength(3);
    for (const [i, expected] of SPEC_POINTS.entries()) {
      expect(points[i]!.latitude).toBeCloseTo(expected.latitude, 5);
      expect(points[i]!.longitude).toBeCloseTo(expected.longitude, 5);
    }
  });

  it("defaults to precision 6, which is what Mapbox Directions returns", () => {
    // The same three points encoded at precision 6. Decoding this with the
    // precision-5 default would silently yield coordinates a factor of ten
    // closer to null island — plausible numbers, completely wrong route.
    const p6 = "_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI";
    const withDefault = decodePolyline(p6);

    expect(withDefault).toEqual(decodePolyline(p6, 6));
    for (const [i, expected] of SPEC_POINTS.entries()) {
      expect(withDefault[i]!.latitude).toBeCloseTo(expected.latitude, 5);
      expect(withDefault[i]!.longitude).toBeCloseTo(expected.longitude, 5);
    }
  });

  it("decodes a street-scale line to contiguous, sane geography", () => {
    // Six vertices running north along Congress Avenue in Austin — the shape
    // and spacing of a real route step.
    const points = decodePolyline("_sjvx@vnwlyDct@oA_{@oAkdAoAsjAoAchAoA");

    expect(points).toHaveLength(6);
    for (const point of points) {
      expect(point.latitude).toBeGreaterThan(30);
      expect(point.latitude).toBeLessThan(31);
      expect(point.longitude).toBeGreaterThan(-98);
      expect(point.longitude).toBeLessThan(-97);
    }

    // Consecutive vertices of a road geometry are metres apart. This catches a
    // decoder that has lost sync but is still producing in-range numbers —
    // the failure mode that would otherwise reach the map looking plausible.
    for (let i = 1; i < points.length; i++) {
      const step = distanceMeters(points[i - 1]!, points[i]!);
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(500);
    }

    // And the line must run monotonically north, as encoded.
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.latitude).toBeGreaterThan(points[i - 1]!.latitude);
    }
  });

  it("accepts the largest legal coordinate", () => {
    // 90,180 needs the full varint width. A guard sized too tightly would
    // reject legitimate geometry near the poles or the antimeridian.
    const points = decodePolyline("_gdtjD_oiivI");
    expect(points[0]!.latitude).toBeCloseTo(90, 5);
    expect(points[0]!.longitude).toBeCloseTo(180, 5);
  });

  it("returns an empty line for empty input", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("throws rather than returning a truncated route", () => {
    // THE DANGEROUS CASE. A route silently missing its tail still draws, still
    // animates, and leads the driver somewhere that is not their destination.
    // Failing loudly is the only acceptable behaviour.
    expect(() => decodePolyline("_p~iF~ps|U_ulL", 5)).toThrow(PolylineError);
  });

  it("rejects a well-formed encoding of an impossible coordinate", () => {
    // Latitude 95. Correctly encoded, geographically meaningless.
    expect(() => decodePolyline("_{ietD?")).toThrow(/out of range/);
  });

  it("rejects a value that never terminates", () => {
    // Every byte has the continuation bit set: a decoder without a shift guard
    // loops here forever, which on a phone is an unrecoverable hang.
    expect(() => decodePolyline("~~~~~~~~~~~~")).toThrow(PolylineError);
  });
});
