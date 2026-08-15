import { z } from "zod";

/**
 * THE VEHICLE MODEL
 *
 * Built to anticipate the full Vehicle Command Center without implementing it.
 * The fields below cover what the product vision names — make, model, year,
 * trim, VIN, plate, mileage, photo, fuel type, purchase info, maintenance,
 * documents, notes — so the schema does not need replacing later. Only a small
 * subset has UI in this phase; the rest is modeled and optional.
 *
 * Every field beyond the identity core is optional on purpose. A user adding
 * their car should be able to type "M3" and be done — demanding a VIN up front
 * is how a premium product turns into paperwork.
 */

export const FUEL_TYPES = [
  "gasoline",
  "diesel",
  "hybrid",
  "plug-in-hybrid",
  "electric",
  "other",
] as const;

export type FuelType = (typeof FUEL_TYPES)[number];

export const DISTANCE_UNITS = ["mi", "km"] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

/**
 * A mileage observation. Modeled as a reading at a point in time rather than a
 * single mutable number, because that is what makes trip accumulation, service
 * intervals, and "miles driven this month" computable later without a
 * migration.
 */
export const odometerReadingSchema = z.object({
  value: z.number().int().nonnegative().max(2_000_000),
  unit: z.enum(DISTANCE_UNITS),
  /** Epoch ms. */
  recordedAt: z.number().int().nonnegative(),
  source: z.enum(["user", "derived", "imported"]),
});

export type OdometerReading = z.infer<typeof odometerReadingSchema>;

export const vehicleSchema = z.object({
  id: z.string().min(1),

  // ---- Identity ----
  nickname: z.string().trim().min(1).max(60),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  year: z.number().int().min(1885).max(2100).optional(),
  trim: z.string().trim().max(60).optional(),

  // ---- Registration ----
  // VIN is 17 characters and excludes I, O, and Q to avoid digit confusion.
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "A VIN is 17 characters and excludes I, O, and Q")
    .optional(),
  licensePlate: z.string().trim().max(12).optional(),

  // ---- Specification ----
  fuelType: z.enum(FUEL_TYPES).optional(),
  color: z.string().trim().max(40).optional(),

  // ---- State ----
  odometer: odometerReadingSchema.optional(),

  // ---- Ownership ----
  purchasedAt: z.number().int().nonnegative().optional(),
  purchasePriceCents: z.number().int().nonnegative().optional(),

  // ---- Media ----
  /**
   * Photo reference. A key into blob storage, not the image itself — putting
   * base64 in the record would bloat every read of every vehicle.
   * NOT YET IMPLEMENTED: no upload path exists in this phase.
   */
  photoKey: z.string().optional(),

  notes: z.string().max(4000).optional(),

  // ---- Bookkeeping ----
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Vehicle = z.infer<typeof vehicleSchema>;

/** Fields a user supplies when creating a vehicle. */
export const vehicleDraftSchema = vehicleSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    nickname: z.string().trim().min(1, "Give this vehicle a name").max(60),
  });

export type VehicleDraft = z.infer<typeof vehicleDraftSchema>;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** "2021 BMW M3 Competition", falling back through what is actually known. */
export function describeVehicle(vehicle: Vehicle): string {
  const parts = [
    vehicle.year?.toString(),
    vehicle.make,
    vehicle.model,
    vehicle.trim,
  ].filter((part): part is string => Boolean(part && part.length > 0));

  return parts.length > 0 ? parts.join(" ") : vehicle.nickname;
}

export function formatOdometer(reading: OdometerReading): string {
  return `${reading.value.toLocaleString("en-US")} ${reading.unit}`;
}
