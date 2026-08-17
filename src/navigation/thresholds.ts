/**
 * NAVIGATION TUNABLES.
 *
 * Every number the engine branches on lives here, named and justified. Scatter
 * them through the algorithm and nobody can answer "why does it reroute in
 * tunnels" without reading all of it — and nobody can tune one without
 * discovering the other four that interact with it.
 *
 * These are starting values chosen from how consumer GPS actually behaves.
 * They are expected to change after a real drive; that is what makes keeping
 * them together worth the file.
 */

// ---------------------------------------------------------------------------
// Sample acceptance
// ---------------------------------------------------------------------------

/**
 * Worst horizontal accuracy still worth using, in metres.
 *
 * Above this a fix says little more than "somewhere on this block". Feeding it
 * to off-route detection is how a stationary car in an urban canyon gets
 * rerouted. Rejected samples are counted, never silently dropped.
 */
export const MAX_USABLE_ACCURACY_M = 50;

/**
 * Accuracy above which a fix is used but treated as weak evidence — it can
 * move progress but cannot on its own accumulate off-route confidence.
 */
export const DEGRADED_ACCURACY_M = 25;

/**
 * Fastest plausible ground speed, in m/s (~270 km/h).
 *
 * A sample implying more than this since the last accepted one is a GPS
 * teleport, not a car. Rejecting it is what keeps a single wild fix from
 * dragging progress hundreds of metres down the route.
 */
export const MAX_PLAUSIBLE_SPEED_MPS = 75;

/** Slack added to the plausibility budget to absorb ordinary accuracy error. */
export const PLAUSIBILITY_SLACK_M = 60;

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/** Beyond this with no accepted fix, the position is stale rather than live. */
export const STALE_AFTER_MS = 5_000;

/**
 * Beyond this, the position is lost.
 *
 * The state is held and reported honestly. Nothing is extrapolated: a driver
 * shown confident progress through a tunnel it was guessing at is worse off
 * than one told the signal is gone.
 */
export const LOST_AFTER_MS = 15_000;

/**
 * A gap longer than this makes the local search window meaningless — the car
 * could be anywhere along the route — so the next fix is matched against the
 * whole line.
 */
export const GAP_FULL_RESEARCH_MS = 6_000;

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * How far back and forward along the route to search, in metres.
 *
 * Expressed as distance rather than a vertex count on purpose: vertex density
 * varies enormously between a straight motorway and a roundabout, so "50
 * vertices" is a different search on every road.
 */
export const SEARCH_BEHIND_M = 120;
export const SEARCH_AHEAD_M = 400;

/**
 * If the best match inside the window is worse than this, the window is
 * probably wrong — the car may have rejoined the route elsewhere — so the
 * whole route is searched before drawing any conclusion.
 */
export const WINDOW_ESCAPE_M = 80;

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * How far progress may move backwards, in metres.
 *
 * Some backward movement is ordinary GPS noise and refusing all of it makes
 * progress ratchet forward on jitter alone. Allowing unlimited backward
 * movement makes the distance-to-maneuver jump around while stopped. This is
 * the compromise.
 */
export const BACKWARD_TOLERANCE_M = 15;

// ---------------------------------------------------------------------------
// Stationary
// ---------------------------------------------------------------------------

/** Below this speed, when speed is actually reported, the car is stopped. */
export const STATIONARY_SPEED_MPS = 0.6;

/**
 * Net displacement over `STATIONARY_WINDOW_MS` below which the car is treated
 * as stopped regardless of what individual samples suggest.
 *
 * This is the defence against the worst stationary artefact: at a light, GPS
 * wanders 10–20m per sample, each individual step looks like 30 km/h, and with
 * a one-sided backward tolerance that phantom motion *ratchets* progress
 * forward and never comes back. Net displacement distinguishes wandering from
 * travelling; instantaneous displacement cannot.
 */
export const STATIONARY_NET_DISPLACEMENT_M = 12;
export const STATIONARY_WINDOW_MS = 6_000;

// ---------------------------------------------------------------------------
// Off-route
// ---------------------------------------------------------------------------

/**
 * The route corridor scales with reported accuracy: a fix good to 5m that is
 * 40m off the line is real divergence, and the same 40m on a fix accurate to
 * 45m is noise.
 */
export const CORRIDOR_ACCURACY_MULTIPLIER = 1.6;
export const CORRIDOR_MIN_M = 30;
export const CORRIDOR_MAX_M = 80;

/** Divergent samples required before off-route can be certain. */
export const OFF_ROUTE_MIN_SAMPLES = 3;

/**
 * Time continuously outside the corridor before off-route can be certain.
 *
 * Both a sample count and a duration, because a 5Hz device would otherwise
 * reach three samples in 600ms — long enough for one swerve, not long enough
 * to be a wrong turn.
 */
export const OFF_ROUTE_MIN_DURATION_MS = 5_000;

/** Angular disagreement with the route that counts as travelling elsewhere. */
export const HEADING_DISAGREEMENT_DEG = 60;

/**
 * Heading below this speed is meaningless — a stationary or crawling device
 * reports whatever direction the last jitter pointed.
 */
export const HEADING_MIN_SPEED_MPS = 2.5;

/** Confidence thresholds for the reported off-route state. */
export const OFF_ROUTE_UNCERTAIN_AT = 0.25;
export const OFF_ROUTE_LIKELY_AT = 0.6;
export const OFF_ROUTE_CERTAIN_AT = 1;

/**
 * How much of the accumulated confidence a single in-corridor sample removes.
 *
 * Recovery is deliberately faster than accumulation. A driver who clips a
 * corner and comes straight back should not be rerouted for it, and the cost
 * of forgetting too quickly is one extra sample of delay.
 */
export const OFF_ROUTE_RECOVERY_FACTOR = 0.5;

// ---------------------------------------------------------------------------
// Arrival + ETA
// ---------------------------------------------------------------------------

/** Remaining distance at which the route is effectively complete. */
export const ARRIVAL_RADIUS_M = 30;

/**
 * Age beyond which the route's own durations are reported as stale.
 *
 * Traffic estimates are made once, when the route is requested. After this
 * long they are still the best number available, but the UI is entitled to
 * know they are old rather than presenting them as current.
 */
export const ETA_STALE_AFTER_MS = 15 * 60_000;
