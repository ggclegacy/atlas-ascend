/**
 * ROUTE OVERVIEW FRAMING.
 *
 * The projection maths — turning a bounding box into a camera — belongs to the
 * map vendor, which already does it correctly for every projection and pitch.
 * What belongs to Atlas is the *padding*: how much of the screen the route is
 * not allowed to occupy, because the preview sheet, the top controls, and the
 * phone's own safe areas are sitting there.
 *
 * That is the part with product judgement in it, so that is the part that is
 * pure and tested here.
 */

export interface EdgePadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface SafeAreaInsets {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * Space above the route for the vehicle chip and map controls, which float
 * over the map and would otherwise sit on top of the first mile.
 */
const TOP_CONTROLS_HEIGHT = 64;

/**
 * Clearance so the origin and destination markers are never clipped.
 *
 * The destination pin is 34px tall and anchored at its point, so it extends
 * upward from the coordinate the bounds were computed from. Framing exactly to
 * the bounds cuts its head off — the marker is outside the box by definition.
 */
const MARKER_CLEARANCE = 44;

/** Matches `--atlas-gutter`. */
const GUTTER = 20;

/**
 * The most of the viewport that padding may consume.
 *
 * Beyond this there is no room left to fit anything into, and a fit against a
 * near-zero box produces an absurd zoom — the route vanishes rather than
 * merely being tight. On a small phone with a tall sheet this is reachable, so
 * padding is scaled down proportionally rather than allowed to win.
 */
const MAX_PADDING_FRACTION = 0.72;

/**
 * Padding for the route-preview camera.
 *
 * Asymmetric on purpose: the sheet occupies the bottom of the screen, so the
 * route is framed into the space that is actually visible rather than into the
 * geometric centre. Centring a route behind its own preview sheet is the most
 * common way this feature is got wrong.
 */
export function routePreviewPadding(
  viewport: Viewport,
  sheetHeight: number,
  safeArea: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 },
): EdgePadding {
  const raw: EdgePadding = {
    top: safeArea.top + TOP_CONTROLS_HEIGHT + MARKER_CLEARANCE,
    bottom: safeArea.bottom + Math.max(0, sheetHeight) + MARKER_CLEARANCE,
    left: safeArea.left + GUTTER,
    right: safeArea.right + GUTTER,
  };

  return scaleToFit(raw, viewport);
}

/**
 * Shrinks padding proportionally until the remaining window is usable.
 *
 * Proportional rather than clamped per edge, because the asymmetry *is* the
 * design — squashing only the bottom would re-centre the route behind the
 * sheet, which is the thing the padding exists to prevent.
 */
function scaleToFit(padding: EdgePadding, viewport: Viewport): EdgePadding {
  const limitY = viewport.height * MAX_PADDING_FRACTION;
  const limitX = viewport.width * MAX_PADDING_FRACTION;

  const totalY = padding.top + padding.bottom;
  const totalX = padding.left + padding.right;

  const scaleY = totalY > limitY && totalY > 0 ? limitY / totalY : 1;
  const scaleX = totalX > limitX && totalX > 0 ? limitX / totalX : 1;

  return {
    top: Math.round(padding.top * scaleY),
    bottom: Math.round(padding.bottom * scaleY),
    left: Math.round(padding.left * scaleX),
    right: Math.round(padding.right * scaleX),
  };
}

/**
 * The tightest the overview camera may go.
 *
 * A 300-metre route fits its bounds at building zoom, where the map shows one
 * intersection, both markers overlap, and the driver cannot tell where they
 * are going. Capping it keeps a short route legible as a *journey* — some
 * surrounding context is part of what a route overview is for.
 */
export const ROUTE_OVERVIEW_MAX_ZOOM = 15.6;

/**
 * Overview is flat.
 *
 * Pitch is for the driving camera, where it conveys motion and the road ahead.
 * A pitched overview foreshortens the far half of the route and makes a
 * north–south route look shorter than an east–west one of the same length.
 */
export const ROUTE_OVERVIEW_PITCH = 0;
export const ROUTE_OVERVIEW_BEARING = 0;
