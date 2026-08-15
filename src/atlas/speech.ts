"use client";

/**
 * VOICE INPUT — what browsers can actually do.
 *
 * Findings that shaped this module, because the web reality is materially
 * different from the native assumption:
 *
 * - **The Web Speech API is not a web standard in practice.** `SpeechRecognition`
 *   is prefixed (`webkitSpeechRecognition`) everywhere it exists.
 * - **Chrome (desktop and Android)** supports it, but streams audio to Google's
 *   servers for recognition. That is a real privacy characteristic to disclose,
 *   not an implementation detail.
 * - **Safari on iOS** exposes `webkitSpeechRecognition` but support is
 *   inconsistent across versions and it requires a direct user gesture. Since
 *   iOS Safari is this product's hero browser, voice cannot be treated as
 *   reliably available.
 * - **Firefox** does not support it at all.
 *
 * Conclusion: browser speech recognition is a progressive enhancement, never a
 * dependency. The `SpeechInputProvider` interface below exists so a
 * server-backed speech-to-text implementation can replace it without the UI
 * changing — which is the path to production-grade voice.
 *
 * The absolute rule: **never claim Atlas heard something when no audio was
 * processed.** If recognition is unavailable, the microphone affordance must
 * say so rather than pretending to listen.
 */

export type SpeechAvailability =
  | { readonly available: true; readonly provider: "browser"; readonly remoteProcessing: boolean }
  | { readonly available: false; readonly reason: SpeechUnavailableReason };

export type SpeechUnavailableReason =
  | "unsupported-browser"
  | "insecure-context"
  | "no-microphone"
  | "permission-denied";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }
  >;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Synchronous capability probe. Does not request permission. */
export function detectSpeechAvailability(): SpeechAvailability {
  if (typeof window === "undefined") {
    return { available: false, reason: "unsupported-browser" };
  }
  if (!window.isSecureContext) {
    return { available: false, reason: "insecure-context" };
  }
  if (getConstructor() === null) {
    return { available: false, reason: "unsupported-browser" };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { available: false, reason: "no-microphone" };
  }

  // Every current implementation of this API performs recognition remotely.
  return { available: true, provider: "browser", remoteProcessing: true };
}

export function speechUnavailableMessage(reason: SpeechUnavailableReason): string {
  switch (reason) {
    case "unsupported-browser":
      return "Voice input isn't supported in this browser";
    case "insecure-context":
      return "Voice input requires a secure connection";
    case "no-microphone":
      return "No microphone available";
    case "permission-denied":
      return "Microphone access was denied";
  }
}

export interface SpeechSession {
  stop(): void;
}

export interface SpeechCallbacks {
  /** Fired with in-progress text. Never treat as final. */
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (reason: SpeechUnavailableReason | "recognition-failed", detail?: string) => void;
  onEnd?: () => void;
}

/**
 * Speech-to-text boundary.
 *
 * A server-backed implementation (recording audio and posting it to a
 * transcription service) satisfies this same interface, which is the intended
 * production path for reliable mobile voice.
 */
export interface SpeechInputProvider {
  readonly id: string;
  availability(): SpeechAvailability;
  start(callbacks: SpeechCallbacks): Promise<SpeechSession | null>;
}

/**
 * Browser Web Speech API implementation.
 *
 * REAL where supported: this genuinely captures audio and returns a genuine
 * transcript. It is not simulated. It is simply unavailable on a meaningful
 * share of target browsers, which `availability()` reports honestly.
 */
export class BrowserSpeechInput implements SpeechInputProvider {
  readonly id = "web-speech-api";

  availability(): SpeechAvailability {
    return detectSpeechAvailability();
  }

  async start(callbacks: SpeechCallbacks): Promise<SpeechSession | null> {
    const availability = this.availability();
    if (!availability.available) {
      callbacks.onError(availability.reason);
      return null;
    }

    const Constructor = getConstructor();
    if (Constructor === null) {
      callbacks.onError("unsupported-browser");
      return null;
    }

    // Request the microphone explicitly first. Doing this before starting
    // recognition produces a clear permission prompt and a clean denial path,
    // rather than a recognition error that is hard to attribute.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Recognition opens its own capture; release this probe immediately so
      // the recording indicator does not stay lit.
      for (const track of stream.getTracks()) track.stop();
    } catch {
      callbacks.onError("permission-denied");
      return null;
    }

    const recognition = new Constructor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const alternative = result[0];
        if (!alternative) continue;

        if (result.isFinal) {
          callbacks.onFinal(alternative.transcript.trim());
        } else {
          callbacks.onPartial?.(alternative.transcript);
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        callbacks.onError("permission-denied");
      } else if (event.error !== "aborted") {
        callbacks.onError("recognition-failed", event.error);
      }
    };

    recognition.onend = () => callbacks.onEnd?.();

    try {
      recognition.start();
    } catch (error) {
      callbacks.onError(
        "recognition-failed",
        error instanceof Error ? error.message : undefined,
      );
      return null;
    }

    return {
      stop: () => {
        try {
          recognition.stop();
        } catch {
          // Already stopped.
        }
      },
    };
  }
}
