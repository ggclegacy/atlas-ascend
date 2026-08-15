"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtlasMark } from "@/components/atlas/AtlasMark";
import {
  ARROW_BY_ORIGIN,
  CloseIcon,
  MicIcon,
  MicOffIcon,
  SearchIcon,
  WaveformIcon,
} from "@/components/atlas/icons";
import { Eyebrow } from "@/components/atlas/primitives";
import { RuleBasedAtlas } from "@/atlas/RuleBasedAtlas";
import type { AtlasContext, AtlasResponse, AtlasStatus } from "@/atlas/types";
import {
  BrowserSpeechInput,
  type SpeechSession,
  speechUnavailableMessage,
} from "@/atlas/speech";
import { AtlasPlaceSearch } from "@/destinations/search";
import {
  type Destination,
  type PlaceSuggestion,
  type SearchFailure,
  suggestionToDestination,
} from "@/destinations/types";
import { formatMiles } from "@/map/types";

/**
 * THE ATLAS COMMAND SURFACE
 *
 * One input serves both destination search and Atlas commands, because from
 * the user's side they are the same act: saying where you want to go. Typing
 * "coffee" searches; typing "take me home" is understood as a command. Building
 * these as two separate surfaces would be an implementation detail leaking into
 * the product.
 *
 * Presented full-screen rather than as a half sheet. A half sheet spends its
 * life fighting the mobile keyboard for vertical space; a full surface with the
 * input pinned to the top never has that argument.
 */

const search = new AtlasPlaceSearch();
const atlas = new RuleBasedAtlas();
const speech = new BrowserSpeechInput();

export function AtlasCommandSheet({
  open,
  onClose,
  onSelectDestination,
  onShowVehicles,
  onLocateSelf,
  context,
  saved,
  recents,
}: {
  open: boolean;
  onClose: () => void;
  onSelectDestination: (destination: Destination) => void;
  onShowVehicles: () => void;
  onLocateSelf: () => void;
  context: AtlasContext;
  saved: readonly Destination[];
  recents: readonly Destination[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AtlasStatus>("idle");
  const [suggestions, setSuggestions] = useState<readonly PlaceSuggestion[]>([]);
  const [searchFailure, setSearchFailure] = useState<SearchFailure | null>(null);
  const [response, setResponse] = useState<AtlasResponse | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<SpeechSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const speechAvailability = useMemo(() => speech.availability(), []);

  // Focus on open. The small delay lets the sheet's transform settle first;
  // focusing mid-animation makes iOS Safari scroll the page unpredictably.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 220);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Reset when closed so reopening is always a clean surface.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setSuggestions([]);
    setResponse(null);
    setSearchFailure(null);
    setSpeechError(null);
    setStatus("idle");
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, [open]);

  // Debounced type-ahead. 220ms is short enough to feel immediate and long
  // enough to avoid a request per keystroke — geocoding is billed per call.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setSearchFailure(null);
      return;
    }

    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      void search
        .search(trimmed, {
          near: context.location ?? undefined,
          signal: controller.signal,
          limit: 6,
        })
        .then((outcome) => {
          if (controller.signal.aborted) return;
          if (outcome.ok) {
            setSuggestions(outcome.suggestions);
            setSearchFailure(null);
          } else {
            setSuggestions([]);
            setSearchFailure(outcome.failure);
          }
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query, context.location]);

  const choose = useCallback(
    (destination: Destination) => {
      onSelectDestination(destination);
      onClose();
    },
    [onSelectDestination, onClose],
  );

  /** Submit runs the text through Atlas before treating it as a raw search. */
  const submit = useCallback(async () => {
    const text = query.trim();
    if (text.length === 0) return;

    setStatus("thinking");
    const outcome = await atlas.ask(text, context);

    if (!outcome.ok) {
      setStatus("error");
      setResponse({
        speech: "Atlas is unavailable right now.",
        intent: null,
        source: "unavailable",
      });
      return;
    }

    const { response: result } = outcome;
    setResponse(result);
    setStatus("responding");

    const intent = result.intent;
    if (intent === null) return;

    switch (intent.kind) {
      case "navigate-saved": {
        const anchor = saved.find((d) => d.origin === intent.place);
        if (anchor) choose(anchor);
        break;
      }
      case "locate-self":
        if (context.location) {
          onLocateSelf();
          onClose();
        }
        break;
      case "show-vehicles":
        onShowVehicles();
        onClose();
        break;
      case "navigate":
        // Atlas resolved a place name; hand it to search and let the user
        // pick, rather than guessing at the first result.
        setQuery(intent.query);
        break;
      case "unrecognized":
        break;
    }
  }, [query, context, saved, choose, onClose, onLocateSelf, onShowVehicles]);

  const toggleListening = useCallback(async () => {
    if (status === "listening") {
      sessionRef.current?.stop();
      sessionRef.current = null;
      setStatus("idle");
      return;
    }

    setSpeechError(null);
    setStatus("listening");

    const session = await speech.start({
      onPartial: (text) => setQuery(text),
      onFinal: (text) => {
        setQuery(text);
        setStatus("idle");
      },
      onError: (reason, detail) => {
        setStatus("idle");
        setSpeechError(
          reason === "recognition-failed"
            ? `Voice input failed${detail ? `: ${detail}` : ""}`
            : speechUnavailableMessage(reason),
        );
      },
      onEnd: () => {
        sessionRef.current = null;
        setStatus((s) => (s === "listening" ? "idle" : s));
      },
    });

    sessionRef.current = session;
    if (session === null) setStatus("idle");
  }, [status]);

  if (!open) return null;

  const showingResults = suggestions.length > 0;
  const showingDefaults = query.trim().length < 2;

  return (
    <div
      className="atlas-chrome fixed inset-0 z-50 flex flex-col bg-graphite"
      role="dialog"
      aria-modal="true"
      aria-label="Atlas command"
      style={{
        paddingTop: "var(--atlas-safe-top)",
        paddingBottom: "var(--atlas-safe-bottom)",
      }}
    >
      {/* ---------- Input row ---------- */}
      <div
        className="flex items-center gap-3 px-[var(--atlas-gutter)] pt-3 pb-4"
        style={{ borderBottom: "1px solid rgb(255 255 255 / 0.06)" }}
      >
        <AtlasMark size={22} active={status !== "idle"} />

        <div className="atlas-surface atlas-surface-control flex h-12 flex-1 items-center gap-2.5 rounded-2xl px-3.5">
          <span className="text-ink-3">
            <SearchIcon size={16} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Where to, or ask Atlas"
            aria-label="Destination or command"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="atlas-subheading atlas-selectable min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear"
              className="grid size-6 place-items-center rounded-full bg-floating text-ink-3"
            >
              <CloseIcon size={12} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="atlas-callout shrink-0 px-1 text-ink-2"
        >
          Cancel
        </button>
      </div>

      {/* ---------- Body ---------- */}
      <div className="atlas-rail flex-1 overflow-y-auto overscroll-contain px-[var(--atlas-gutter)] py-5">
        {response && (
          <AtlasResponseCard response={response} thinking={status === "thinking"} />
        )}

        {speechError && (
          <p className="atlas-label mb-4 text-caution">{speechError}</p>
        )}

        {searchFailure && <SearchFailureNote failure={searchFailure} />}

        {showingResults && (
          <section className="flex flex-col gap-1">
            <Eyebrow>Results</Eyebrow>
            <ul className="mt-2 flex flex-col">
              {suggestions.map((suggestion) => (
                <li key={suggestion.id}>
                  <ResultRow
                    title={suggestion.name}
                    subtitle={suggestion.address}
                    trailing={
                      suggestion.distanceMeters === null
                        ? null
                        : `${formatMiles(suggestion.distanceMeters)} mi`
                    }
                    onClick={() => choose(suggestionToDestination(suggestion))}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {showingDefaults && (
          <div className="flex flex-col gap-7">
            {saved.length > 0 && (
              <section>
                <Eyebrow>Saved</Eyebrow>
                <ul className="mt-2 flex flex-col">
                  {saved.map((destination) => (
                    <li key={destination.id}>
                      <ResultRow
                        icon={destination.icon}
                        title={destination.name}
                        subtitle={destination.address}
                        onClick={() => choose(destination)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {recents.length > 0 && (
              <section>
                <Eyebrow>Recent</Eyebrow>
                <ul className="mt-2 flex flex-col">
                  {recents.map((destination) => (
                    <li key={destination.id}>
                      <ResultRow
                        icon="recent"
                        title={destination.name}
                        subtitle={destination.address}
                        onClick={() => choose(destination)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {saved.length === 0 && recents.length === 0 && !response && (
              <EmptyGuidance />
            )}
          </div>
        )}
      </div>

      {/* ---------- Mic ---------- */}
      <div className="flex items-center justify-center gap-3 px-[var(--atlas-gutter)] pb-4">
        {speechAvailability.available ? (
          <button
            type="button"
            onClick={() => void toggleListening()}
            aria-label={status === "listening" ? "Stop listening" : "Speak to Atlas"}
            className={[
              "grid size-14 place-items-center rounded-full transition-all duration-300 active:scale-95",
              status === "listening"
                ? "bg-violet-core text-ink"
                : "atlas-surface atlas-surface-control text-ink-2",
            ].join(" ")}
          >
            {status === "listening" ? <WaveformIcon size={20} /> : <MicIcon size={20} />}
          </button>
        ) : (
          // Never a dead button: the control is visibly unavailable and says
          // why, rather than sitting there doing nothing when tapped.
          <div className="flex items-center gap-2.5 opacity-60">
            <span className="grid size-11 place-items-center rounded-full border border-white/8 text-ink-4">
              <MicOffIcon size={18} />
            </span>
            <span className="atlas-label text-ink-3">
              {speechUnavailableMessage(speechAvailability.reason)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AtlasResponseCard({
  response,
  thinking,
}: {
  response: AtlasResponse;
  thinking: boolean;
}) {
  return (
    <div className="atlas-surface atlas-surface-card mb-6 rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <AtlasMark size={18} active />
        <div className="flex flex-1 flex-col gap-1.5">
          <Eyebrow tick={false} tone={response.source === "unavailable" ? "caution" : "gold"}>
            {thinking
              ? "Working"
              : response.source === "rules"
                ? "Atlas"
                : response.source === "model"
                  ? "Atlas"
                  : "Atlas · limited"}
          </Eyebrow>
          <p className="atlas-body text-ink">{response.speech}</p>
        </div>
      </div>
    </div>
  );
}

function SearchFailureNote({ failure }: { failure: SearchFailure }) {
  const message =
    failure === "not-configured"
      ? "Place search needs a Mapbox token. Set NEXT_PUBLIC_MAPBOX_TOKEN and redeploy."
      : failure === "rate-limited"
        ? "Too many searches just now. Try again in a moment."
        : "Search is unavailable right now.";

  return (
    <div className="mb-5 rounded-xl border border-caution/25 bg-caution/8 px-3.5 py-3">
      <p className="atlas-label text-caution">{message}</p>
    </div>
  );
}

function EmptyGuidance() {
  return (
    <div className="flex flex-col gap-3 pt-2">
      <Eyebrow>Try</Eyebrow>
      <ul className="flex flex-col gap-2">
        {[
          "An address or place name",
          "“Take me home”",
          "“Where am I”",
          "“Show my vehicles”",
        ].map((example) => (
          <li key={example} className="atlas-body text-ink-3">
            {example}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultRow({
  icon,
  title,
  subtitle,
  trailing,
  onClick,
}: {
  icon?: keyof typeof ARROW_BY_ORIGIN;
  title: string;
  subtitle?: string | null;
  trailing?: string | null;
  onClick: () => void;
}) {
  const Icon = icon ? ARROW_BY_ORIGIN[icon] : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-xl py-3 text-left transition-colors active:bg-white/4"
    >
      <span className="atlas-surface atlas-surface-control grid size-9 shrink-0 place-items-center rounded-full text-ink-2">
        {Icon ? <Icon size={15} /> : <SearchIcon size={15} />}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="atlas-subheading truncate text-ink">{title}</span>
        {subtitle && (
          <span className="atlas-label truncate text-ink-3">{subtitle}</span>
        )}
      </span>

      {trailing && (
        <span className="atlas-readout-sm shrink-0 text-ink-3">{trailing}</span>
      )}
    </button>
  );
}
