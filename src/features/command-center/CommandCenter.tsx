"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { MapHandle } from "@/map/provider";
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
import { LocalVehicleStore } from "@/vehicles/store";
import type { Vehicle } from "@/vehicles/types";
import { describeVehicle, formatOdometer } from "@/vehicles/types";
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
  const [destination, setDestination] = useState<Destination | null>(null);
  const [following, setFollowing] = useState(true);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [saved, setSaved] = useState<Destination[]>([]);
  const [recents, setRecents] = useState<Destination[]>([]);

  const mapRef = useRef<MapHandle | null>(null);
  const hasCenteredRef = useRef(false);

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

  const selectDestination = useCallback(
    (next: Destination) => {
      setDestination(next);
      destinationStore.recordUse(next);
      setRecents(destinationStore.recents());
      setFollowing(false);
      mapRef.current?.setDestination(next.coordinate);
      mapRef.current?.setCamera(
        { center: next.coordinate, zoom: 15.5 },
        "cinematic",
      );
    },
    [destinationStore],
  );

  const clearDestination = useCallback(() => {
    setDestination(null);
    mapRef.current?.setDestination(null);
  }, []);

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

  const simulationNotes = useMemo(() => {
    const notes: string[] = [];
    if (vehicles.length > 0) notes.push("Vehicles stored on this device only");
    if (destination !== null) notes.push("Routing not implemented");
    return notes;
  }, [vehicles.length, destination]);

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

          {destination && (
            <DestinationBanner
              destination={destination}
              onClear={clearDestination}
            />
          )}

          <DestinationRail
            saved={saved}
            recents={recents}
            onSelect={selectDestination}
            onBrowse={() => setSheetOpen(true)}
          />

          <PromptBar onOpen={() => setSheetOpen(true)} />
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

function DestinationBanner({
  destination,
  onClear,
}: {
  destination: Destination;
  onClear: () => void;
}) {
  return (
    <div className="atlas-edge-gold flex items-center gap-3 rounded-2xl px-4 py-3">
      <span className="text-gold">
        <NavigationIcon size={15} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <Eyebrow tick={false} tone="gold">
          Destination set
        </Eyebrow>
        <span className="atlas-subheading truncate text-ink">
          {destination.name}
        </span>
        {/* Honest: a destination is marked, but no route has been computed.
            Claiming an ETA here would be inventing one. */}
        <span className="atlas-label text-ink-3">
          Routing and ETA not available yet
        </span>
      </span>
      <button
        type="button"
        onClick={onClear}
        className="atlas-label shrink-0 text-ink-2"
      >
        Clear
      </button>
    </div>
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
