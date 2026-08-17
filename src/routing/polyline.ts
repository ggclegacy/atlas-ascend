import type { Coordinate } from "@/map/types";

/**
 * ENCODED POLYLINE DECODER
 *
 * Mapbox Directions can return route geometry either as GeoJSON or as an
 * encoded polyline. Atlas asks for `polyline6`, and this decodes it.
 *
 * Why not GeoJSON, which would need no decoder: a full-overview highway route
 * is thousands of vertices, and as GeoJSON each one costs ~40 bytes of JSON
 * against ~6 bytes encoded. On a phone on cellular, at the exact moment the
 * driver is waiting to see their route — and again on every reroute — that
 * difference is worth forty lines of arithmetic.
 *
 * Why not `@mapbox/polyline`, which does exactly this: it is a dependency for
 * one small pure function that has not changed since 2008. The algorithm is
 * Google's encoded polyline format, and it is fully specified.
 *
 * `polyline6` means six decimal places (~11cm), which is what Mapbox uses for
 * Directions. The classic Google format is precision 5; the parameter exists
 * so a future provider using precision 5 does not need a second decoder.
 */

/** Thrown when the input is not a well-formed encoded polyline. */
export class PolylineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolylineError";
  }
}

/** Latitude/longitude bounds beyond which a decode has clearly gone wrong. */
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

/**
 * Decodes an encoded polyline into coordinates.
 *
 * Throws `PolylineError` rather than returning a partial line. A truncated
 * route silently missing its last third is far more dangerous than a route
 * that fails loudly and is retried — the driver would follow it.
 */
export function decodePolyline(
  encoded: string,
  precision: number = 6,
): Coordinate[] {
  if (encoded.length === 0) return [];

  const factor = 10 ** precision;
  const coordinates: Coordinate[] = [];

  let index = 0;
  let latitudeE = 0;
  let longitudeE = 0;

  while (index < encoded.length) {
    // Each coordinate is a latitude delta followed by a longitude delta, both
    // zig-zag encoded and split into 5-bit chunks with a continuation bit.
    const latitudeDelta = readSignedValue();
    const longitudeDelta = readSignedValue();

    latitudeE += latitudeDelta;
    longitudeE += longitudeDelta;

    const latitude = latitudeE / factor;
    const longitude = longitudeE / factor;

    // A decoder that has lost sync produces plausible-looking numbers far out
    // of range rather than failing, so the range check is the real guard.
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > MAX_LATITUDE ||
      Math.abs(longitude) > MAX_LONGITUDE
    ) {
      throw new PolylineError(
        `decoded coordinate ${latitude},${longitude} is out of range at index ${index}`,
      );
    }

    coordinates.push({ latitude, longitude });
  }

  return coordinates;

  /** Reads one zig-zag encoded varint, advancing `index`. */
  function readSignedValue(): number {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      if (index >= encoded.length) {
        throw new PolylineError(
          `polyline ended mid-value at index ${index} (truncated input)`,
        );
      }

      byte = encoded.charCodeAt(index++) - 63;

      if (byte < 0) {
        throw new PolylineError(
          `invalid character "${encoded[index - 1]}" at index ${index - 1}`,
        );
      }

      // Six chunks is 30 bits, past which a precision-6 delta cannot legally
      // go. Without this a corrupt stream loops shifting forever.
      if (shift > 30) {
        throw new PolylineError(`value at index ${index} exceeds 32 bits`);
      }

      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    // Low bit set means the original value was negative.
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}
