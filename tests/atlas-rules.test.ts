import { describe, expect, it } from "vitest";
import { RuleBasedAtlas } from "@/atlas/RuleBasedAtlas";
import type { AtlasContext } from "@/atlas/types";

const atlas = new RuleBasedAtlas();

const FULL: AtlasContext = {
  location: { latitude: 30.2672, longitude: -97.7431 },
  hasHome: true,
  hasWork: true,
  vehicleCount: 2,
};

const EMPTY: AtlasContext = {
  location: null,
  hasHome: false,
  hasWork: false,
  vehicleCount: 0,
};

describe("rule-based Atlas", () => {
  it("recognizes going home in several phrasings", async () => {
    for (const phrase of [
      "take me home",
      "Take me home.",
      "go home",
      "navigate home",
      "drive home",
      "home",
    ]) {
      const outcome = await atlas.ask(phrase, FULL);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(outcome.response.intent).toEqual({
        kind: "navigate-saved",
        place: "home",
      });
    }
  });

  it("recognizes work", async () => {
    const outcome = await atlas.ask("take me to work", FULL);
    expect(outcome.ok && outcome.response.intent).toEqual({
      kind: "navigate-saved",
      place: "work",
    });
  });

  it("extracts a destination from a navigate command", async () => {
    const outcome = await atlas.ask("navigate to 123 Main Street", FULL);
    expect(outcome.ok && outcome.response.intent).toEqual({
      kind: "navigate",
      query: "123 Main Street",
    });
  });

  it("recognizes locating yourself and showing vehicles", async () => {
    const where = await atlas.ask("where am I", FULL);
    expect(where.ok && where.response.intent?.kind).toBe("locate-self");

    const vehicles = await atlas.ask("show my vehicles", FULL);
    expect(vehicles.ok && vehicles.response.intent?.kind).toBe("show-vehicles");
  });

  it("says it does not understand rather than improvising", async () => {
    const outcome = await atlas.ask(
      "what is the airspeed velocity of an unladen swallow",
      FULL,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // The critical assertion: unrecognized input is reported as unavailable,
    // never answered with a plausible-sounding invention.
    expect(outcome.response.source).toBe("unavailable");
    expect(outcome.response.intent?.kind).toBe("unrecognized");
  });

  it("admits when no home address is configured instead of pretending", async () => {
    const outcome = await atlas.ask("take me home", EMPTY);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.speech).toMatch(/haven't set a home address/i);
  });

  it("admits when it has no location", async () => {
    const outcome = await atlas.ask("where am I", EMPTY);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.speech).toMatch(/don't have your location/i);
  });

  it("never reports a source implying fabrication", async () => {
    const outcome = await atlas.ask("take me home", FULL);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(["rules", "model", "unavailable"]).toContain(outcome.response.source);
  });

  it("returns an empty response for empty input", async () => {
    const outcome = await atlas.ask("   ", FULL);
    expect(outcome.ok && outcome.response.speech).toBe("");
  });

  it("reports its own capabilities honestly", () => {
    expect(atlas.capabilities.rules).toBe(true);
    // No model is wired, and the provider must not claim otherwise.
    expect(atlas.capabilities.naturalLanguage).toBe(false);
  });
});
