"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AtlasMark } from "@/components/atlas/AtlasMark";
import {
  ARROW_BY_ORIGIN,
  CarIcon,
  CompassIcon,
  LayersIcon,
  LocateIcon,
  MapIcon,
  MicIcon,
  NavigationIcon,
  PlusIcon,
} from "@/components/atlas/icons";
import {
  Eyebrow,
  IconButton,
  Metric,
  Pill,
  SimulationBadge,
} from "@/components/atlas/primitives";
import type { AtlasContext } from "@/atlas/types";
import { LocalDestinationStore } from "@/destinations/store";
import type { Destination } from "@/destinations/types";
import {
  type LocationPermission,
  useGeolocation,
} from "@/location/useGeolocation";
import type { MapBounds, MapHandle } from "@/map/provider";
import type { AtlasRoute } from "@/routing/types";
import {
  DEFAULT_CAMERA,
  type MapConfiguration,
  type MapPerspective,
  PERSPECTIVES,
  metersPerSecondToMph,
  perspectiveLabel,
  pitchFor,
} from "@/map/types";
import {
  isAvailable,
  mapReading,
  type Reading,
  unavailable,
} from "@/lib/provenance";
import { isMapDebugRequested } from "@/map/mapbox/diagnostics";
import { LocalVehicleStore } from "@/vehicles/store";
import type { Vehicle } from "@/vehicles/types";
import { describeVehicle, formatOdometer } from "@/vehicles/types";
import {
  INITIAL_NAVIGATION_STATE,
  type NavigationFailure,
  destinationOf,
  type NavigationState,
  navigationReducer,
  routesOf,
  selectedRouteOf,
} from "@/navigation/machine";
import {
  ROUTE_OVERVIEW_MAX_ZOOM,
  routePreviewPadding,
} from "@/navigation/framing";
import { AtlasRouting } from "@/routing/AtlasRouting";
import { NavigationDiagnostics } from "@/features/navigation/NavigationDiagnostics";
import {
  NavigationStarting,
  RouteFailure,
  RouteLoading,
  RoutePreview,
} from "@/features/navigation/RoutePreview";
import { AtlasCommandSheet } from "./AtlasCommandSheet";
import { MapErrorBoundary } from "./MapErrorBoundary";
import { MapSurface } from "./MapSurface";

/**
 * THE COMMAND CENTER — Atlas Ascend's primary surface.
 *
 * The central design decision, carried over from the Swift foundation: **the
 * map is the screen, not a component on it.** It runs edge to edge behind
 * everything, and all controls float above it on glass. The moment the map is
 * boxed into a rectangle, the product reads as a dashboard that happens to
 * contain a map rather than a surface you are moving through.
 *
 * Legibility over that full-bleed map comes from gradient scrims, never solid
 * bars — a bar guarantees the same contrast and severs the spatial illusion
 * doing it.
 *
 * Layout, top to bottom: vehicle context and map controls on the top rail; the
 * map breathing through the middle; telemetry, saved destinations, and the
 * Atlas prompt at thumb height along the bottom.
 */

export function CommandCenter() {
  const router = useRouter();
  const location = useGeolocation();

  const [perspective, setPerspective] = useState<MapPerspective>("driving");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [nav, dispatch] = useReducer(navigationReducer, INITIAL_NAVIGATION_STATE);
  const [following, setFollowing] = useState(true);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [saved, setSaved] = useState<Destination[]>([]);
  const [recents, setRecents] = useState<Destination[]>([]);

  const mapRef = useRef<MapHandle | null>(null);
  const hasCenteredRef = useRef(false);
  const routing = useMemo(() => new AtlasRouting(), []);
  /**
   * Monotonic id for route requests, and the abort handle for the one in
   * flight. Changing destination mid-request is ordinary use; without both of
   * these a slow route to the previous destination lands after a fast route to
   * the current one and silently wins.
   */
  const requestSeq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  /** Frozen at preview time so the arrival clock does not tick while reading. */
  const [previewNow, setPreviewNow] = useState(() => Date.now());
  const [debug, setDebug] = useState(false);
  const [drawn, setDrawn] = useState<{ id: string | null; layers: number }>({
    id: null,
    layers: 0,
  });

  useEffect(() => setDebug(isMapDebugRequested()), []);

  // Poll what the map is actually drawing. Comparing it against what the state
  // machine believes is the whole point — they should never disagree, and when
  // they do that is the bug.
  useEffect(() => {
    if (!debug) return;
    const timer = setInterval(() => {
      const route = mapRef.current?.inspect().route;
      setDrawn({
        id: route?.primaryRouteId ?? null,
        layers: route?.layerCount ?? 0,
      });
    }, 600);
    return () => clearInterval(timer);
  }, [debug]);

  const destinationStore = useMemo(() => new LocalDestinationStore(), []);
  const vehicleStore = useMemo(() => new LocalVehicleStore(), []);

  const configuration: MapConfiguration = useMemo(
    () => ({
      camera: DEFAULT_CAMERA,
      style: "atlasNight",
      perspective: "driving",
      annotations: [],
    }),
    [],
  );

  // Load persisted state after mount. Reading localStorage during render
  // would produce a server/client markup mismatch.
  useEffect(() => {
    setSaved(destinationStore.saved());
    setRecents(destinationStore.recents());
    void vehicleStore.list().then(setVehicles);
  }, [destinationStore, vehicleStore]);

  // Push the live fix to the map. The puck only exists once a real position
  // arrives — there is no placeholder position at any point.
  useEffect(() => {
    const handle = mapRef.current;
    if (!handle) return;

    if (!isAvailable(location.fix)) {
      handle.setUserLocation(null, null);
      return;
    }

    const { coordinate } = location.fix.value;
    const heading = isAvailable(location.heading) ? location.heading.value : null;
    handle.setUserLocation(coordinate, heading);

    // Fly to the user the first time only; after that, follow without
    // animating each update or the camera visibly drifts.
    if (!hasCenteredRef.current) {
      hasCenteredRef.current = true;
      handle.setCamera({ center: coordinate, zoom: 16.4 }, "cinematic");
    } else if (following) {
      handle.setCamera({ center: coordinate }, "immediate");
    }
  }, [location.fix, location.heading, following]);

  const handleMapReady = useCallback((handle: MapHandle) => {
    mapRef.current = handle;
  }, []);

  // A hand gesture breaks follow-mode; the recenter button restores it. This
  // is the behavior every good navigation app has, and its absence is felt
  // immediately.
  const handleUserInteraction = useCallback(() => setFollowing(false), []);

  const cyclePerspective = useCallback(() => {
    const index = PERSPECTIVES.indexOf(perspective);
    const next = PERSPECTIVES[(index + 1) % PERSPECTIVES.length] as MapPerspective;
    setPerspective(next);
    mapRef.current?.setPerspective(next, "cinematic");
  }, [perspective]);

  const recenter = useCallback(() => {
    if (!isAvailable(location.fix)) {
      location.request();
      return;
    }
    setFollowing(true);
    mapRef.current?.setCamera(
      { center: location.fix.value.coordinate, zoom: 16.4 },
      "standard",
    );
  }, [location]);

  /**
   * Requests a route and drives the machine through it.
   *
   * The `requestId` is what makes a superseded response harmless: the reducer
   * discards any result it is no longer waiting for, and the abort stops the
   * request being billed and parsed at all.
   */
  const requestRoute = useCallback(
    async (destination: Destination) => {
      const origin = isAvailable(location.fix)
        ? location.fix.value.coordinate
        : null;

      const requestId = ++requestSeq.current;

      // No origin means no route. Said plainly, with the action that fixes it,
      // rather than a spinner that never resolves.
      if (origin === null) {
        dispatch({ type: "ROUTE_REQUESTED", requestId });
        dispatch({ type: "ROUTE_FAILED", requestId, failure: "no-location" });
        return;
      }

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      dispatch({ type: "ROUTE_REQUESTED", requestId });

      const outcome = await routing.route({
        origin,
        destination,
        alternatives: true,
        headingDegrees: isAvailable(location.heading)
          ? location.heading.value
          : null,
        signal: controller.signal,
      });

      if (inFlight.current === controller) inFlight.current = null;

      if (outcome.ok) {
        setPreviewNow(Date.now());
        dispatch({ type: "ROUTE_SUCCEEDED", requestId, routes: outcome.routes });
      } else {
        dispatch({ type: "ROUTE_FAILED", requestId, failure: outcome.failure });
      }
    },
    [location.fix, location.heading, routing],
  );

  const selectDestination = useCallback(
    (next: Destination) => {
      dispatch({ type: "DESTINATION_SELECTED", destination: next });
      destinationStore.recordUse(next);
      setRecents(destinationStore.recents());
      // A route overview owns the camera; follow-mode would fight it.
      setFollowing(false);
      setSheetOpen(false);
      void requestRoute(next);
    },
    [destinationStore, requestRoute],
  );

  /**
   * Cancel — the full teardown.
   *
   * Everything the preview created has to go, or the next session inherits a
   * gold route to nowhere and a stale ETA. The order matters only in that the
   * request is aborted first, so its response cannot arrive mid-cleanup.
   */
  const cancelNavigation = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    // Invalidates any response still in flight, belt and braces.
    requestSeq.current++;
    dispatch({ type: "CANCEL" });

    const map = mapRef.current;
    map?.clearRoutes();
    map?.setDestination(null);
    setFollowing(true);
    if (isAvailable(location.fix)) {
      map?.setCamera(
        { center: location.fix.value.coordinate, zoom: 16.4, pitch: pitchFor(perspective) },
        "cinematic",
      );
    }
  }, [location.fix, perspective]);

  const retryRoute = useCallback(() => {
    const destination = destinationOf(nav);
    if (destination !== null) void requestRoute(destination);
  }, [nav, requestRoute]);

  const startDrive = useCallback(() => {
    const origin = isAvailable(location.fix)
      ? location.fix.value.coordinate
      : null;
    // The session records where the drive actually began. Without an origin
    // there is no session worth creating, and there is no route either.
    if (origin === null) return;
    dispatch({ type: "START_DRIVE", at: Date.now(), origin });
  }, [location.fix]);

  /**
   * The single point where navigation state reaches the map.
   *
   * Split by dependency on purpose. This effect runs when the *set* of routes
   * changes — a new request, or a teardown — and does the expensive work.
   * Selecting an alternate is handled separately below, because promoting a
   * route the map already holds must not rebuild layers or refit the camera.
   */
  const routes = routesOf(nav);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (routes.length === 0) {
      map.clearRoutes();
      return;
    }

    map.setRoutes(routes, routes[0]?.id ?? null);

    // Frame into the space the sheet does not occupy. Centring the route
    // geometrically would put half of it behind its own preview.
    const bounds = unionBounds(routes);
    const padding = routePreviewPadding(
      { width: window.innerWidth, height: window.innerHeight },
      PREVIEW_SHEET_HEIGHT,
      readSafeAreaInsets(),
    );
    map.frameBounds(bounds, padding, {
      maxZoom: ROUTE_OVERVIEW_MAX_ZOOM,
      transition: "cinematic",
    });
  }, [routes]);

  /**
   * Alternate selection — a restyle, never a rebuild.
   *
   * `selectRoute` swaps which geometry is drawn as primary using data the map
   * already holds. No request, no re-decode, no camera move: the driver is
   * comparing two options and the map jumping each time would make that
   * comparison harder, not easier.
   */
  const selectedRouteId = selectedRouteOf(nav)?.id ?? null;
  useEffect(() => {
    if (selectedRouteId !== null) mapRef.current?.selectRoute(selectedRouteId);
  }, [selectedRouteId]);

  const atlasContext: AtlasContext = useMemo(
    () => ({
      location: isAvailable(location.fix) ? location.fix.value.coordinate : null,
      hasHome: saved.some((d) => d.origin === "home"),
      hasWork: saved.some((d) => d.origin === "work"),
      vehicleCount: vehicles.length,
    }),
    [location.fix, saved, vehicles.length],
  );

  // Speed comes from the Geolocation API in m/s and is null far more often
  // than not. Converting a Reading preserves the unavailable case rather than
  // collapsing it to a number.
  const speedMph = useMemo(
    () => mapReading(location.speed, metersPerSecondToMph),
    [location.speed],
  );

  const activeVehicle = vehicles[0] ?? null;

  /** True once a destination is committed to — anything past browsing. */
  const navActive = nav.phase !== "idle" && nav.phase !== "searching";

  const simulationNotes = useMemo(() => {
    const notes: string[] = [];
    if (vehicles.length > 0) notes.push("Vehicles stored on this device only");
    if (nav.phase === "navigationStarting") {
      notes.push("Turn-by-turn guidance not implemented");
    }
    return notes;
  }, [vehicles.length, nav.phase]);

  const perspectiveIcon =
    perspective === "driving" ? (
      <NavigationIcon size={17} />
    ) : perspective === "oriented" ? (
      <CompassIcon size={17} />
    ) : (
      <MapIcon size={17} />
    );

  return (
    <main className="atlas-viewport atlas-chrome bg-obsidian">
      {/* Layering is explicit rather than relying on DOM order alone.
          The map is the environmental layer and must always sit beneath the
          scrims and chrome — a map that covers Atlas's controls is as broken as
          one that does not render. An error boundary keeps a map failure from
          unmounting the Command Center around it. */}
      <div className="absolute inset-0 z-0">
        <MapErrorBoundary>
          <MapSurface
            configuration={configuration}
            onReady={handleMapReady}
            onUserInteraction={handleUserInteraction}
          />
        </MapErrorBoundary>
      </div>

      {/* ---------- Scrims ---------- */}
      <div
        aria-hidden="true"
        className="atlas-scrim-top pointer-events-none absolute inset-x-0 top-0 z-10 h-44"
      />
      <div
        aria-hidden="true"
        className="atlas-scrim-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 h-72"
      />

      {/* ---------- Content ---------- */}
      <div
        className="pointer-events-none absolute inset-0 z-20 flex flex-col"
        style={{
          paddingTop: "calc(var(--atlas-safe-top) + 10px)",
          paddingBottom: "calc(var(--atlas-safe-bottom) + 14px)",
          paddingLeft: "calc(var(--atlas-safe-left) + var(--atlas-gutter))",
          paddingRight: "calc(var(--atlas-safe-right) + var(--atlas-gutter))",
        }}
      >
        {/* ---------- Top rail ---------- */}
        <div className="pointer-events-auto flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <VehicleChip
              vehicle={activeVehicle}
              onClick={() => router.push("/vehicles")}
            />

            <div className="flex-1" />

            <IconButton
              icon={perspectiveIcon}
              label={`Map perspective: ${perspectiveLabel(perspective)}`}
              active={perspective !== "overview"}
              onClick={cyclePerspective}
            />
            <IconButton
              icon={<LayersIcon size={17} />}
              label="Map layers — not available yet"
              disabled
              onClick={() => undefined}
            />
          </div>

          <SimulationBadge notes={simulationNotes} />
        </div>

        <div className="flex-1" />

        {/* ---------- Bottom stack ---------- */}
        <div className="pointer-events-auto flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <TelemetryBlock
              speed={speedMph}
              acquiring={location.acquiring}
              permission={location.permission}
              onEnable={location.request}
            />
            <div className="flex-1" />
            <IconButton
              icon={<LocateIcon size={17} />}
              label={
                isAvailable(location.fix)
                  ? "Recenter on your location"
                  : "Enable location"
              }
              active={following && isAvailable(location.fix)}
              onClick={recenter}
            />
          </div>

          {debug && (
            <NavigationDiagnostics
              state={nav}
              now={previewNow}
              drawnRouteId={drawn.id}
              drawnLayerCount={drawn.layers}
            />
          )}

          <NavigationSurface
            state={nav}
            now={previewNow}
            onSelectRoute={(routeId) =>
              dispatch({ type: "ALTERNATE_SELECTED", routeId })
            }
            onStartDrive={startDrive}
            onCancel={cancelNavigation}
            onRetry={retryRoute}
          />

          {/* Browsing controls retreat once a route is on screen.
              The rail and the prompt bar exist to *find* a destination; once
              one is chosen the only decisions left are which route and whether
              to drive it. Leaving them stacked under the preview competes with
              that decision and pushes the sheet up into the map. */}
          {!navActive && (
            <>
              <DestinationRail
                saved={saved}
                recents={recents}
                onSelect={selectDestination}
                onBrowse={() => setSheetOpen(true)}
              />

              <PromptBar onOpen={() => setSheetOpen(true)} />
            </>
          )}
        </div>
      </div>

      <AtlasCommandSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSelectDestination={selectDestination}
        onShowVehicles={() => router.push("/vehicles")}
        onLocateSelf={recenter}
        context={atlasContext}
        saved={saved}
        recents={recents}
      />
    </main>
  );
}

// ---------------------------------------------------------------------------

/**
 * Height reserved for the preview sheet when framing the route.
 *
 * A measured value would be more precise, but measuring requires the sheet to
 * exist, and the camera has to be framed as the route arrives — before it
 * does. A constant that matches the sheet's minimum keeps the two in step; the
 * padding logic scales it down on small viewports anyway.
 */
const PREVIEW_SHEET_HEIGHT = 236;

/** The smallest box containing every route on offer. */
function unionBounds(routes: readonly AtlasRoute[]): MapBounds {
  let south = 90;
  let west = 180;
  let north = -90;
  let east = -180;

  for (const route of routes) {
    south = Math.min(south, route.bounds.southwest.latitude);
    west = Math.min(west, route.bounds.southwest.longitude);
    north = Math.max(north, route.bounds.northeast.latitude);
    east = Math.max(east, route.bounds.northeast.longitude);
  }

  return {
    southwest: { latitude: south, longitude: west },
    northeast: { latitude: north, longitude: east },
  };
}

/**
 * The device's safe-area insets, in CSS pixels.
 *
 * Read from the computed style rather than assumed, because they are zero on
 * desktop, substantial on a notched phone, and change on rotation. Framing a
 * route without them puts the destination marker under the home indicator.
 */
function readSafeAreaInsets(): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (typeof window === "undefined") {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : 0;
  };
  return {
    top: read("--atlas-safe-top"),
    bottom: read("--atlas-safe-bottom"),
    left: read("--atlas-safe-left"),
    right: read("--atlas-safe-right"),
  };
}

/**
 * Renders whichever navigation surface the current phase calls for.
 *
 * A single switch over the state union rather than a stack of conditional
 * renders, so exactly one surface can ever be on screen — the property the
 * state machine exists to guarantee, expressed where it is visible.
 */
function NavigationSurface({
  state,
  now,
  onSelectRoute,
  onStartDrive,
  onCancel,
  onRetry,
}: {
  state: NavigationState;
  now: number;
  onSelectRoute: (routeId: string) => void;
  onStartDrive: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  switch (state.phase) {
    case "destinationSelected":
    case "routing":
      return (
        <RouteLoading destination={state.destination} onCancel={onCancel} />
      );

    case "routePreview":
      return (
        <RoutePreview
          destination={state.destination}
          routes={state.routes}
          selectedId={state.selectedId}
          now={now}
          onSelectRoute={onSelectRoute}
          onStartDrive={onStartDrive}
          onCancel={onCancel}
        />
      );

    case "routeFailed":
      return (
        <RouteFailure
          destination={state.destination}
          failure={state.failure}
          // Retrying a destination that was never routable, or a request the
          // app itself abandoned, would just fail again the same way.
          onRetry={retryableFailures.has(state.failure) ? onRetry : null}
          onDismiss={onCancel}
        />
      );

    case "navigationStarting":
      return (
        <NavigationStarting
          destination={state.session.destination}
          route={state.session.route}
          now={now}
          onExit={onCancel}
        />
      );

    default:
      return null;
  }
}

/** Failures where trying the same request again could plausibly succeed. */
const retryableFailures: ReadonlySet<NavigationFailure> = new Set<NavigationFailure>([
  "network",
  "timeout",
  "rate-limited",
  "error",
  "malformed-response",
  "no-location",
]);

function VehicleChip({
  vehicle,
  onClick,
}: {
  vehicle: Vehicle | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="atlas-glass flex h-11 items-center gap-2.5 rounded-[20px] pl-2 pr-3.5 transition-transform active:scale-[0.97]"
      aria-label={vehicle ? `${vehicle.nickname}. Open vehicles.` : "Add a vehicle"}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-gold">
        {vehicle ? <CarIcon size={13} /> : <PlusIcon size={13} />}
      </span>
      <span className="flex flex-col items-start">
        <span className="atlas-callout leading-tight text-ink">
          {vehicle ? vehicle.nickname : "Add vehicle"}
        </span>
        <span className="atlas-eyebrow text-ink-3">
          {vehicle?.odometer ? formatOdometer(vehicle.odometer) : "Garage"}
        </span>
      </span>
    </button>
  );
}

/**
 * Telemetry, plus the location permission affordance.
 *
 * These share a slot because they are the same idea in two states: when
 * location is unknown, the useful thing is a way to grant it, not a dash.
 */
function TelemetryBlock({
  speed,
  acquiring,
  permission,
  onEnable,
}: {
  speed: Reading<number>;
  acquiring: boolean;
  permission: LocationPermission;
  onEnable: () => void;
}) {
  if (permission === "prompt" || permission === "unknown") {
    return (
      <button
        type="button"
        onClick={onEnable}
        className="atlas-glass flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 transition-transform active:scale-[0.97]"
      >
        <span className="text-violet-halo">
          <LocateIcon size={15} />
        </span>
        <span className="flex flex-col items-start">
          <span className="atlas-eyebrow text-ink-3">Location</span>
          <span className="atlas-callout text-ink">Enable</span>
        </span>
      </button>
    );
  }

  if (permission === "denied" || permission === "unsupported") {
    return (
      <div className="flex flex-col gap-1.5">
        <Eyebrow tone="caution">
          {permission === "denied" ? "Location denied" : "Location unsupported"}
        </Eyebrow>
        <span className="atlas-label max-w-[15rem] text-ink-3">
          {permission === "denied"
            ? "Allow location in your browser settings to see speed and position."
            : "This browser cannot provide location."}
        </span>
      </div>
    );
  }

  return (
    <Metric
      label={acquiring ? "Acquiring" : "Speed"}
      reading={acquiring ? unavailable<number>("acquiring") : speed}
      format={(value) => String(value)}
      unit="mph"
      size="large"
    />
  );
}

function DestinationRail({
  saved,
  recents,
  onSelect,
  onBrowse,
}: {
  saved: readonly Destination[];
  recents: readonly Destination[];
  onSelect: (destination: Destination) => void;
  onBrowse: () => void;
}) {
  const items = [...saved, ...recents].slice(0, 6);

  if (items.length === 0) return null;

  return (
    <div className="atlas-rail -mx-[var(--atlas-gutter)] overflow-x-auto px-[var(--atlas-gutter)]">
      <div className="flex gap-2 pb-0.5">
        {items.map((destination, index) => {
          const Icon = ARROW_BY_ORIGIN[destination.icon];
          return (
            <Pill
              key={destination.id}
              icon={<Icon size={12} />}
              title={destination.name}
              accented={index === 0}
              onClick={() => onSelect(destination)}
            />
          );
        })}
        <Pill title="More" onClick={onBrowse} />
      </div>
    </div>
  );
}

/**
 * The Atlas prompt bar.
 *
 * The product thesis in one control: Atlas is not a tab you visit, it is
 * present on the primary surface at thumb height. It is the widest, calmest
 * element on screen and it stays still until spoken to.
 */
function PromptBar({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open Atlas. Search for a destination or ask a question."
      className="atlas-glass flex h-[58px] w-full items-center gap-3 rounded-[29px] pl-4 pr-2 transition-transform active:scale-[0.99]"
      style={{ boxShadow: "0 10px 30px rgb(0 0 0 / 0.5)" }}
    >
      <AtlasMark size={22} />
      <span className="atlas-subheading flex-1 text-left text-ink-2">
        Where to?
      </span>
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-raised text-ink-2">
        <MicIcon size={17} />
      </span>
    </button>
  );
}
