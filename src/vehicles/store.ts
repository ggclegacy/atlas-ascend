"use client";

import {
  type Vehicle,
  type VehicleDraft,
  vehicleSchema,
} from "./types";

/**
 * VEHICLE PERSISTENCE — boundary first, implementation second.
 *
 * `durability` is part of the interface because it is a user-visible fact, not
 * an implementation detail. Data that lives only in one browser can be lost by
 * clearing site data and does not follow the user to another device. The UI
 * must be able to say so, which it cannot do if the store hides it.
 *
 * The production implementation (Postgres + auth, see ARCHITECTURE.md) will
 * satisfy this same interface with `durability: "account-synced"`. No feature
 * code changes when it lands.
 */

export type StoreDurability =
  /** Persists in this browser only. Survives reload, not a cleared cache
   *  and not a different device. */
  | "device-local"
  /** Persists server-side against an authenticated account. */
  | "account-synced";

export interface VehicleStore {
  readonly id: string;
  readonly durability: StoreDurability;
  list(): Promise<Vehicle[]>;
  get(id: string): Promise<Vehicle | null>;
  create(draft: VehicleDraft): Promise<Vehicle>;
  update(id: string, patch: Partial<VehicleDraft>): Promise<Vehicle>;
  remove(id: string): Promise<void>;
}

const STORAGE_KEY = "atlas.vehicles.v1";

/**
 * Browser-local vehicle store.
 *
 * This is REAL persistence — a vehicle created here genuinely survives a
 * reload and a browser restart. It is not simulated. What it is *not* is
 * synced, backed up, or authenticated, which is why `durability` reports
 * `device-local` and the UI discloses it.
 *
 * Records are re-validated on read rather than trusted. localStorage is
 * user-writable and survives across deploys, so a schema change or a hand-edit
 * would otherwise inject malformed objects straight into the app.
 */
export class LocalVehicleStore implements VehicleStore {
  readonly id = "local-storage";
  readonly durability: StoreDurability = "device-local";

  async list(): Promise<Vehicle[]> {
    return this.readAll().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Vehicle | null> {
    return this.readAll().find((vehicle) => vehicle.id === id) ?? null;
  }

  async create(draft: VehicleDraft): Promise<Vehicle> {
    const now = Date.now();
    const vehicle: Vehicle = {
      ...draft,
      id: newId(),
      createdAt: now,
      updatedAt: now,
    };

    const parsed = vehicleSchema.parse(vehicle);
    this.writeAll([...this.readAll(), parsed]);
    return parsed;
  }

  async update(id: string, patch: Partial<VehicleDraft>): Promise<Vehicle> {
    const all = this.readAll();
    const index = all.findIndex((vehicle) => vehicle.id === id);
    if (index === -1) throw new Error(`No vehicle with id ${id}`);

    const existing = all[index] as Vehicle;
    const updated = vehicleSchema.parse({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });

    all[index] = updated;
    this.writeAll(all);
    return updated;
  }

  async remove(id: string): Promise<void> {
    this.writeAll(this.readAll().filter((vehicle) => vehicle.id !== id));
  }

  private readAll(): Vehicle[] {
    if (typeof localStorage === "undefined") return [];

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      // Drop unparseable records rather than throwing. One corrupt entry must
      // not make the whole garage unreadable.
      const vehicles: Vehicle[] = [];
      for (const candidate of parsed) {
        const result = vehicleSchema.safeParse(candidate);
        if (result.success) vehicles.push(result.data);
      }
      return vehicles;
    } catch {
      return [];
    }
  }

  private writeAll(vehicles: Vehicle[]): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicles));
    } catch (error) {
      // Quota exceeded, or Safari private mode where localStorage throws on
      // write. Surfaced rather than swallowed so the caller can tell the user
      // their vehicle was not saved.
      throw new Error(
        `Could not save vehicle: ${error instanceof Error ? error.message : "storage unavailable"}`,
      );
    }
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `veh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
