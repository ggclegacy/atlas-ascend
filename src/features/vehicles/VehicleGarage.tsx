"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CarIcon,
  ChevronLeftIcon,
  CloseIcon,
  PlusIcon,
} from "@/components/atlas/icons";
import { Eyebrow } from "@/components/atlas/primitives";
import { LocalVehicleStore } from "@/vehicles/store";
import {
  DISTANCE_UNITS,
  FUEL_TYPES,
  type FuelType,
  type Vehicle,
  type VehicleDraft,
  describeVehicle,
  formatOdometer,
  vehicleDraftSchema,
} from "@/vehicles/types";

/**
 * THE GARAGE — the beginning of the Vehicle Command Center.
 *
 * Genuinely functional: vehicles created here are validated, persisted, and
 * survive a reload. What is deliberately absent is everything the brief said
 * not to build yet — maintenance intelligence, receipt capture, service
 * history. The data model in `vehicles/types.ts` already anticipates all of it,
 * so none of this needs replacing when that work begins.
 *
 * The durability disclosure at the bottom is not boilerplate. Data that lives
 * in one browser can be lost by clearing site data, and the user is entitled to
 * know that before they type in a VIN.
 */
export function VehicleGarage() {
  const router = useRouter();
  const store = useMemo(() => new LocalVehicleStore(), []);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);

  const refresh = useCallback(async () => {
    setVehicles(await store.list());
    setLoading(false);
  }, [store]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await store.remove(id);
      await refresh();
    },
    [store, refresh],
  );

  return (
    <main
      className="atlas-chrome min-h-dvh bg-graphite"
      style={{
        paddingTop: "calc(var(--atlas-safe-top) + 8px)",
        paddingBottom: "calc(var(--atlas-safe-bottom) + 24px)",
      }}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-[var(--atlas-gutter)]">
        {/* ---------- Header ---------- */}
        <header className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.push("/")}
            aria-label="Back to Command Center"
            className="atlas-surface atlas-surface-control grid size-10 shrink-0 place-items-center rounded-full text-ink-2 transition-transform active:scale-95"
          >
            <ChevronLeftIcon size={18} />
          </button>
          <div className="flex flex-1 flex-col">
            <Eyebrow>Garage</Eyebrow>
            <h1 className="atlas-title mt-1 text-ink">Vehicles</h1>
          </div>
          <button
            type="button"
            onClick={() => setComposing(true)}
            aria-label="Add vehicle"
            className="atlas-edge-gold grid size-10 shrink-0 place-items-center rounded-full text-gold transition-transform active:scale-95"
          >
            <PlusIcon size={18} />
          </button>
        </header>

        <div className="atlas-gold-rule" />

        {/* ---------- List ---------- */}
        {loading ? (
          <p className="atlas-label py-8 text-center text-ink-3">Loading…</p>
        ) : vehicles.length === 0 ? (
          <EmptyGarage onAdd={() => setComposing(true)} />
        ) : (
          <ul className="flex flex-col gap-3">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id}>
                <VehicleCard vehicle={vehicle} onDelete={() => void remove(vehicle.id)} />
              </li>
            ))}
          </ul>
        )}

        {/* ---------- Durability disclosure ---------- */}
        {!loading && (
          <p className="atlas-label mt-2 text-ink-4">
            {store.durability === "device-local"
              ? "Stored in this browser only. Not synced, not backed up — clearing site data will remove these vehicles."
              : "Synced to your account."}
          </p>
        )}
      </div>

      {composing && (
        <VehicleComposer
          onCancel={() => setComposing(false)}
          onSave={async (draft) => {
            await store.create(draft);
            setComposing(false);
            await refresh();
          }}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------

function EmptyGarage({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-5 py-16 text-center">
      <span className="atlas-surface atlas-surface-card grid size-16 place-items-center rounded-full text-ink-3">
        <CarIcon size={26} />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="atlas-heading text-ink">No vehicles yet</h2>
        <p className="atlas-body max-w-xs text-ink-2">
          Add a vehicle and Atlas can start tracking its mileage, service, and
          history.
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="atlas-edge-gold rounded-full px-6 py-3 transition-transform active:scale-[0.97]"
      >
        <span className="atlas-callout text-ink">Add your first vehicle</span>
      </button>
    </div>
  );
}

function VehicleCard({
  vehicle,
  onDelete,
}: {
  vehicle: Vehicle;
  onDelete: () => void;
}) {
  const description = describeVehicle(vehicle);
  const showDescription = description !== vehicle.nickname;

  return (
    <article className="atlas-surface atlas-surface-card flex items-center gap-4 rounded-2xl p-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-raised text-gold">
        <CarIcon size={20} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="atlas-subheading truncate text-ink">{vehicle.nickname}</h2>
        {showDescription && (
          <p className="atlas-label truncate text-ink-2">{description}</p>
        )}
        <p className="atlas-readout-sm text-ink-3">
          {vehicle.odometer ? formatOdometer(vehicle.odometer) : "No mileage recorded"}
        </p>
      </div>

      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${vehicle.nickname}`}
        className="grid size-9 shrink-0 place-items-center rounded-full text-ink-4 transition-colors active:text-critical"
      >
        <CloseIcon size={15} />
      </button>
    </article>
  );
}

// ---------------------------------------------------------------------------

/**
 * Vehicle creation.
 *
 * Only the nickname is required. Demanding a VIN or a full spec up front is how
 * a premium product turns into paperwork — the schema accepts everything, the
 * form asks for almost nothing.
 */
function VehicleComposer({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (draft: VehicleDraft) => Promise<void>;
}) {
  const [nickname, setNickname] = useState("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [odometer, setOdometer] = useState("");
  const [unit, setUnit] = useState<(typeof DISTANCE_UNITS)[number]>("mi");
  const [fuelType, setFuelType] = useState<FuelType | "">("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    setError(null);

    const odometerValue = odometer.trim() === "" ? null : Number(odometer);
    if (odometerValue !== null && !Number.isFinite(odometerValue)) {
      setError("Mileage must be a number");
      return;
    }

    const candidate = {
      nickname: nickname.trim(),
      ...(year.trim() ? { year: Number(year) } : {}),
      ...(make.trim() ? { make: make.trim() } : {}),
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(fuelType ? { fuelType } : {}),
      ...(odometerValue !== null
        ? {
            odometer: {
              value: Math.round(odometerValue),
              unit,
              recordedAt: Date.now(),
              source: "user" as const,
            },
          }
        : {}),
    };

    const parsed = vehicleDraftSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the details and try again");
      return;
    }

    setSaving(true);
    try {
      await onSave(parsed.data);
    } catch (caught) {
      setSaving(false);
      setError(caught instanceof Error ? caught.message : "Could not save vehicle");
    }
  }, [nickname, year, make, model, fuelType, odometer, unit, onSave]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-graphite"
      role="dialog"
      aria-modal="true"
      aria-label="Add vehicle"
      style={{
        paddingTop: "var(--atlas-safe-top)",
        paddingBottom: "var(--atlas-safe-bottom)",
      }}
    >
      <header className="flex items-center justify-between px-[var(--atlas-gutter)] py-4">
        <button type="button" onClick={onCancel} className="atlas-callout text-ink-2">
          Cancel
        </button>
        <Eyebrow tick={false}>New vehicle</Eyebrow>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || nickname.trim().length === 0}
          className="atlas-callout text-gold disabled:opacity-35"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      <div className="atlas-rail flex-1 overflow-y-auto px-[var(--atlas-gutter)] pb-8">
        <div className="mx-auto flex max-w-md flex-col gap-5">
          <Field label="Name" hint="What you call it">
            <TextInput
              value={nickname}
              onChange={setNickname}
              placeholder="The M3"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Year">
              <TextInput
                value={year}
                onChange={setYear}
                placeholder="2021"
                inputMode="numeric"
              />
            </Field>
            <Field label="Make">
              <TextInput value={make} onChange={setMake} placeholder="BMW" />
            </Field>
            <Field label="Model">
              <TextInput value={model} onChange={setModel} placeholder="M3" />
            </Field>
          </div>

          <Field label="Mileage">
            <div className="flex gap-2">
              <TextInput
                value={odometer}
                onChange={setOdometer}
                placeholder="48312"
                inputMode="numeric"
              />
              <div className="flex shrink-0 overflow-hidden rounded-xl border border-white/8">
                {DISTANCE_UNITS.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => setUnit(candidate)}
                    className={[
                      "atlas-label px-3.5 py-2 transition-colors",
                      unit === candidate
                        ? "bg-raised text-ink"
                        : "bg-transparent text-ink-3",
                    ].join(" ")}
                  >
                    {candidate}
                  </button>
                ))}
              </div>
            </div>
          </Field>

          <Field label="Fuel">
            <div className="flex flex-wrap gap-2">
              {FUEL_TYPES.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() =>
                    setFuelType(fuelType === candidate ? "" : candidate)
                  }
                  className={[
                    "atlas-label rounded-full px-3.5 py-2 transition-colors",
                    fuelType === candidate
                      ? "atlas-edge-gold text-ink"
                      : "atlas-surface atlas-surface-control text-ink-3",
                  ].join(" ")}
                >
                  {candidate.replace(/-/g, " ")}
                </button>
              ))}
            </div>
          </Field>

          {error && <p className="atlas-label text-critical">{error}</p>}

          <p className="atlas-label text-ink-4">
            VIN, plate, photos, purchase details, and service history are part of
            the vehicle model but do not have a form yet.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-baseline gap-2">
        <Eyebrow tick={false}>{label}</Eyebrow>
        {hint && <span className="atlas-label text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  inputMode,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "text" | "numeric";
  autoFocus?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      autoFocus={autoFocus}
      autoComplete="off"
      className="atlas-surface atlas-surface-control atlas-subheading atlas-selectable w-full rounded-xl px-3.5 py-3 text-ink outline-none placeholder:text-ink-4"
    />
  );
}
