import type {
  AtlasContext,
  AtlasIntent,
  AtlasOutcome,
  AtlasProvider,
} from "./types";

/**
 * RULE-BASED ATLAS — real, deterministic, no model required.
 *
 * This is genuinely functional code, not a simulation. It recognizes a defined
 * command set by pattern and returns a real intent the Command Center then
 * really carries out.
 *
 * The important design decision is what it does with everything else: it says
 * it does not understand, and reports `source: "unavailable"`. It never
 * improvises a plausible-sounding reply. An assistant that fakes comprehension
 * is worse than one with an honest, narrow vocabulary — the user learns to
 * distrust every answer, including the correct ones.
 *
 * When a language model is configured, `ModelAtlasProvider` will handle
 * anything these rules miss, and these rules stay as the fast, offline,
 * zero-cost path for the commands that matter most while driving.
 */

interface Rule {
  readonly pattern: RegExp;
  readonly build: (match: RegExpMatchArray, context: AtlasContext) => AtlasIntent | null;
}

/** Ordered — first match wins, so specific patterns precede general ones. */
const RULES: readonly Rule[] = [
  {
    // "take me home", "go home", "navigate home", "drive home", "head home"
    pattern: /^(?:atlas[,\s]+)?(?:take me |bring me |get me |navigate |drive |go |head )?home\.?$/i,
    build: () => ({ kind: "navigate-saved", place: "home" }),
  },
  {
    pattern: /^(?:atlas[,\s]+)?(?:take me |bring me |get me |navigate |drive |go |head )?to work\.?$/i,
    build: () => ({ kind: "navigate-saved", place: "work" }),
  },
  {
    pattern: /^(?:atlas[,\s]+)?(?:go|drive|head) to work\.?$/i,
    build: () => ({ kind: "navigate-saved", place: "work" }),
  },
  {
    // "where am i", "where are we"
    pattern: /^(?:atlas[,\s]+)?where (?:am i|are we)\??\.?$/i,
    build: () => ({ kind: "locate-self" }),
  },
  {
    pattern: /^(?:atlas[,\s]+)?(?:show|list|open)(?: me)?(?: my)? (?:vehicles?|cars?|garage)\.?$/i,
    build: () => ({ kind: "show-vehicles" }),
  },
  {
    // "navigate to X", "take me to X", "directions to X", "drive to X"
    pattern:
      /^(?:atlas[,\s]+)?(?:navigate to|take me to|bring me to|get me to|directions to|drive to|go to|find)\s+(.+?)\.?$/i,
    build: (match) => {
      const query = match[1]?.trim();
      if (!query || query.length < 2) return null;
      return { kind: "navigate", query };
    },
  },
];

export class RuleBasedAtlas implements AtlasProvider {
  readonly id = "atlas-rules";
  readonly capabilities = { rules: true, naturalLanguage: false };

  async ask(text: string, context: AtlasContext): Promise<AtlasOutcome> {
    const input = text.trim();
    if (input.length === 0) {
      return { ok: true, response: { speech: "", intent: null, source: "rules" } };
    }

    for (const rule of RULES) {
      const match = input.match(rule.pattern);
      if (!match) continue;

      const intent = rule.build(match, context);
      if (intent === null) continue;

      const speech = describe(intent, context);
      if (speech === null) continue; // Rule matched but cannot be fulfilled.

      return { ok: true, response: { speech, intent, source: "rules" } };
    }

    // Honest failure. Note it reports what Atlas *can* do rather than
    // apologizing — a narrow vocabulary is only frustrating if it is secret.
    return {
      ok: true,
      response: {
        speech:
          "I don't understand that yet. Right now I can navigate to an address, take you home or to work, tell you where you are, and open your vehicles.",
        intent: { kind: "unrecognized", text: input },
        source: "unavailable",
      },
    };
  }
}

/**
 * The spoken response for an intent, or `null` when the intent cannot be
 * fulfilled given current context — in which case the caller falls through to
 * the next rule rather than promising something impossible.
 */
function describe(intent: AtlasIntent, context: AtlasContext): string | null {
  switch (intent.kind) {
    case "navigate-saved": {
      const configured = intent.place === "home" ? context.hasHome : context.hasWork;
      if (!configured) {
        return `You haven't set a ${intent.place} address yet. Search for it and save it, and I'll take you there next time.`;
      }
      return intent.place === "home" ? "Heading home." : "Heading to work.";
    }

    case "navigate":
      return `Looking up ${intent.query}.`;

    case "locate-self":
      return context.location === null
        ? "I don't have your location. Enable location access and I'll tell you where you are."
        : "Showing where you are now.";

    case "show-vehicles":
      return context.vehicleCount === 0
        ? "You haven't added a vehicle yet. Opening your garage so you can."
        : "Opening your vehicles.";

    case "unrecognized":
      return null;
  }
}
