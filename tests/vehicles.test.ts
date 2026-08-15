import { describe, expect, it } from "vitest";
import {
  describeVehicle,
  formatOdometer,
  type Vehicle,
  vehicleDraftSchema,
  vehicleSchema,
} from "@/vehicles/types";

const BASE: Vehicle = {
  id: "veh_1",
  nickname: "The M3",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

describe("vehicle schema", () => {
  it("requires only a nickname", () => {
    const result = vehicleDraftSchema.safeParse({ nickname: "Daily" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty nickname with a usable message", () => {
    const result = vehicleDraftSchema.safeParse({ nickname: "   " });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toMatch(/name/i);
  });

  it("accepts a valid VIN and uppercases it", () => {
    const result = vehicleDraftSchema.safeParse({
      nickname: "The M3",
      vin: "wba8e9g59gnt12345",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.vin).toBe("WBA8E9G59GNT12345");
  });

  it("rejects VINs containing I, O, or Q", () => {
    // Those letters are excluded from the VIN standard precisely because they
    // are confusable with 1 and 0 — accepting them would let a typo through.
    const result = vehicleDraftSchema.safeParse({
      nickname: "The M3",
      vin: "WBA8E9G59GNTI2345",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a VIN of the wrong length", () => {
    expect(
      vehicleDraftSchema.safeParse({ nickname: "x", vin: "WBA8E9G59GNT123" })
        .success,
    ).toBe(false);
  });

  it("rejects implausible model years", () => {
    expect(vehicleDraftSchema.safeParse({ nickname: "x", year: 1700 }).success).toBe(
      false,
    );
    expect(vehicleDraftSchema.safeParse({ nickname: "x", year: 2021 }).success).toBe(
      true,
    );
  });

  it("rejects a negative odometer", () => {
    const result = vehicleSchema.safeParse({
      ...BASE,
      odometer: {
        value: -5,
        unit: "mi",
        recordedAt: Date.now(),
        source: "user",
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid odometer reading", () => {
    const result = vehicleSchema.safeParse({
      ...BASE,
      odometer: {
        value: 48_312,
        unit: "mi",
        recordedAt: 1_700_000_000_000,
        source: "user",
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("vehicle display", () => {
  it("builds a description from whatever is known", () => {
    expect(
      describeVehicle({ ...BASE, year: 2021, make: "BMW", model: "M3" }),
    ).toBe("2021 BMW M3");
  });

  it("falls back to the nickname when nothing else is known", () => {
    expect(describeVehicle(BASE)).toBe("The M3");
  });

  it("omits missing parts rather than leaving gaps", () => {
    expect(describeVehicle({ ...BASE, make: "BMW", model: "M3" })).toBe("BMW M3");
  });

  it("formats an odometer with grouping and unit", () => {
    expect(
      formatOdometer({
        value: 48_312,
        unit: "mi",
        recordedAt: 0,
        source: "user",
      }),
    ).toBe("48,312 mi");
  });
});
