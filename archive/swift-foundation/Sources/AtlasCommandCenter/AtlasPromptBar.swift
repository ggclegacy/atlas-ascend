import SwiftUI
import AtlasDesign

/// The conversational entry point to Atlas.
///
/// This bar is the product thesis in one control: Atlas is not a tab you visit,
/// it is present on the primary surface and reachable without navigating
/// anywhere. It sits at thumb height over a live map, and it is the widest,
/// calmest element on screen.
///
/// Restraint is the design here. It would be easy to make this glow, pulse, and
/// animate constantly; instead it is still until spoken to, and violet only
/// arrives when Atlas is actually engaged.
struct AtlasPromptBar: View {
    let state: AtlasState
    let onTapField: () -> Void
    let onTapMic: () -> Void

    private var isEngaged: Bool { state != .idle }

    private var promptText: String {
        switch state {
        case .idle: "Where to?"
        case .listening: "Listening"
        case .thinking: "Working on it"
        }
    }

    var body: some View {
        HStack(spacing: AtlasSpace.sm) {
            AtlasMark(size: 22, isActive: isEngaged)
                .frame(width: 28)

            Button(action: onTapField) {
                HStack(spacing: AtlasSpace.xs) {
                    Text(promptText)
                        .atlasType(AtlasType.subheading)
                        .foregroundStyle(
                            isEngaged ? AtlasColor.textPrimary : AtlasColor.textSecondary
                        )
                        .contentTransition(.opacity)

                    if state == .thinking {
                        AtlasThinkingIndicator()
                    }

                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if state == .listening {
                // Decorative only — see AtlasWaveform.
                AtlasWaveform()
                    .transition(.opacity.combined(with: .scale(scale: 0.8)))
            }

            micButton
        }
        .padding(.leading, AtlasSpace.md)
        .padding(.trailing, AtlasSpace.xs)
        .frame(height: 62)
        .atlasSurface(.glass, radius: AtlasRadius.xl)
        .overlay {
            // Violet edge only while engaged. Gold would be wrong here — this
            // is intelligence state, not accent.
            if isEngaged {
                AtlasRadius.shape(AtlasRadius.xl)
                    .strokeBorder(AtlasViolet.edge, lineWidth: 1)
            }
        }
        .shadow(color: .black.opacity(0.5), radius: 24, y: 10)
        .animation(AtlasMotion.considered, value: state)
    }

    private var micButton: some View {
        Button(action: onTapMic) {
            ZStack {
                Circle()
                    .fill(
                        state == .listening
                            ? AnyShapeStyle(AtlasColor.violetCore)
                            : AnyShapeStyle(AtlasColor.raised)
                    )
                    .frame(width: 46, height: 46)

                Circle()
                    .strokeBorder(
                        state == .listening ? AtlasColor.violetHalo.opacity(0.7) : AtlasColor.hairline,
                        lineWidth: 1
                    )
                    .frame(width: 46, height: 46)

                Image(systemName: state == .listening ? "waveform" : "mic.fill")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(
                        state == .listening ? AtlasColor.textPrimary : AtlasColor.textSecondary
                    )
            }
        }
        .buttonStyle(.atlasPress)
        .accessibilityLabel(state == .listening ? "Stop listening" : "Speak to Atlas")
    }
}

/// Animated bars shown while listening.
///
/// ⚠️ DECORATIVE: not audio-reactive. No microphone tap feeds this. It signals
/// "the mic affordance is engaged", nothing more. When real speech input lands,
/// this should be driven by actual input power or removed — an amplitude
/// display that ignores amplitude is the kind of small dishonesty that erodes
/// trust in everything else on screen.
private struct AtlasWaveform: View {
    @State private var animating = false

    private let heights: [CGFloat] = [10, 18, 26, 16, 9]

    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(heights.enumerated()), id: \.offset) { index, height in
                Capsule()
                    .fill(AtlasColor.violetHalo)
                    .frame(width: 3, height: animating ? height : height * 0.4)
                    .animation(
                        .easeInOut(duration: 0.55)
                        .repeatForever(autoreverses: true)
                        .delay(Double(index) * 0.09),
                        value: animating
                    )
            }
        }
        .frame(height: 28)
        .onAppear { animating = true }
        .accessibilityHidden(true)
    }
}

/// Three-dot progress for the thinking state.
private struct AtlasThinkingIndicator: View {
    @State private var phase = 0.0

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(AtlasColor.violetHalo)
                    .frame(width: 5, height: 5)
                    .opacity(phase == Double(index) ? 1 : 0.3)
            }
        }
        .onAppear {
            withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                phase = 2
            }
        }
        .accessibilityHidden(true)
    }
}
