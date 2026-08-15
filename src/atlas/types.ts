import type { Coordinate } from "@/map/types";

/**
 * ATLAS — the intelligence layer's interaction contract.
 *
 * The states here are the full lifecycle of a request, defined up front so the
 * UI does not have to be rebuilt when a real model is connected behind it.
 */

export type AtlasStatus =
  /** Waiting, showing its prompt. */
  | "idle"
  /** Microphone engaged and audio is genuinely being captured. */
  | "listening"
  /** Request submitted, working. */
  | "thinking"
  /** A response is available. */
  | "responding"
  /** The request failed. */
  | "error";

/** What Atlas concluded the user wants. */
export type AtlasIntent =
  | { readonly kind: "navigate"; readonly query: string }
  | { readonly kind: "navigate-saved"; readonly place: "home" | "work" }
  | { readonly kind: "locate-self" }
  | { readonly kind: "show-vehicles" }
  | { readonly kind: "unrecognized"; readonly text: string };

/** How Atlas answered. */
export interface AtlasResponse {
  /** Prose shown to the user. Always present, even for an action. */
  readonly speech: string;
  /** An action the UI should carry out, if any. */
  readonly intent: AtlasIntent | null;
  /**
   * Where this answer came from. `rules` is a real deterministic parse;
   * `model` is a real language model; `unavailable` means Atlas could not
   * answer and said so. There is deliberately no value meaning "made up".
   */
  readonly source: "rules" | "model" | "unavailable";
}

export interface AtlasContext {
  /** The user's position, when known. Never fabricated. */
  readonly location: Coordinate | null;
  readonly hasHome: boolean;
  readonly hasWork: boolean;
  readonly vehicleCount: number;
}

export type AtlasFailure = "not-configured" | "network" | "rate-limited" | "error";

export type AtlasOutcome =
  | { readonly ok: true; readonly response: AtlasResponse }
  | { readonly ok: false; readonly failure: AtlasFailure; readonly detail?: string };

/**
 * The intelligence provider.
 *
 * `capabilities` lets the UI describe honestly what Atlas can currently do
 * rather than presenting an open-ended assistant that silently fails on most
 * input.
 */
export interface AtlasProvider {
  readonly id: string;
  readonly capabilities: {
    /** Deterministic command matching, no model required. */
    readonly rules: boolean;
    /** Open-ended natural language via a model. */
    readonly naturalLanguage: boolean;
  };
  ask(text: string, context: AtlasContext): Promise<AtlasOutcome>;
}
