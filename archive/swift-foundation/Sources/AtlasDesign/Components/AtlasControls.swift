import SwiftUI

// MARK: - Icon button

/// A square glass icon button, used for map controls and floating actions.
///
/// Sized to a 44pt tap target regardless of the icon inside it. The `isActive`
/// state is the one place ordinary chrome earns violet — an engaged map control
/// is live system state, which is exactly what violet is reserved for.
public struct AtlasIconButton: View {
    private let systemImage: String
    private let label: String
    private let isActive: Bool
    private let action: () -> Void

    public init(
        systemImage: String,
        label: String,
        isActive: Bool = false,
        action: @escaping () -> Void
    ) {
        self.systemImage = systemImage
        self.label = label
        self.isActive = isActive
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(isActive ? AtlasColor.violetHalo : AtlasColor.textSecondary)
                .frame(width: AtlasSpace.tapTarget, height: AtlasSpace.tapTarget)
                .atlasSurface(.glass, radius: AtlasRadius.md)
                .overlay {
                    if isActive {
                        AtlasRadius.shape(AtlasRadius.md)
                            .strokeBorder(AtlasViolet.edge, lineWidth: 1)
                    }
                }
        }
        .buttonStyle(.atlasPress)
        .animation(AtlasMotion.swift, value: isActive)
        .accessibilityLabel(label)
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
    }
}

// MARK: - Pill

/// A compact rounded control: icon plus label. Used for saved destinations,
/// filters, and inline actions.
public struct AtlasPill: View {

    public enum Emphasis: Sendable {
        /// Default glass treatment.
        case standard
        /// Gold edge. At most one per cluster — the accent stops meaning
        /// anything the moment it is applied to everything.
        case accented
    }

    private let systemImage: String?
    private let title: String
    private let detail: String?
    private let emphasis: Emphasis
    private let action: () -> Void

    public init(
        systemImage: String? = nil,
        title: String,
        detail: String? = nil,
        emphasis: Emphasis = .standard,
        action: @escaping () -> Void
    ) {
        self.systemImage = systemImage
        self.title = title
        self.detail = detail
        self.emphasis = emphasis
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: AtlasSpace.xs) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(
                            emphasis == .accented ? AtlasColor.gold : AtlasColor.textSecondary
                        )
                }

                Text(title)
                    .atlasType(AtlasType.callout)
                    .foregroundStyle(AtlasColor.textPrimary)

                if let detail {
                    Text(detail)
                        .atlasType(AtlasType.readoutSmall)
                        .foregroundStyle(AtlasColor.textTertiary)
                }
            }
            .padding(.horizontal, AtlasSpace.md)
            .frame(height: 38)
            .atlasSurface(
                .glass,
                radius: AtlasRadius.lg,
                accented: emphasis == .accented
            )
        }
        .buttonStyle(.atlasPress)
        .accessibilityLabel(detail.map { "\(title), \($0)" } ?? title)
    }
}

// MARK: - Live indicator

/// A breathing dot for live state — GPS lock, Atlas listening, active trip.
///
/// The halo animates, the core does not. Animating both reads as a throbbing
/// alert; animating only the halo reads as a steady signal with presence.
public struct AtlasLiveDot: View {
    private let tint: Color
    private let isLive: Bool

    @State private var breathing = false

    public init(tint: Color = AtlasColor.positive, isLive: Bool = true) {
        self.tint = tint
        self.isLive = isLive
    }

    public var body: some View {
        ZStack {
            Circle()
                .fill(tint.opacity(0.28))
                .frame(width: 16, height: 16)
                .scaleEffect(breathing ? 1.0 : 0.55)
                .opacity(breathing ? 0.0 : 0.9)

            Circle()
                .fill(isLive ? tint : AtlasColor.textQuaternary)
                .frame(width: 6, height: 6)
        }
        .frame(width: 16, height: 16)
        .onAppear {
            guard isLive else { return }
            withAnimation(AtlasMotion.ambient) { breathing = true }
        }
        .accessibilityHidden(true)
    }
}
