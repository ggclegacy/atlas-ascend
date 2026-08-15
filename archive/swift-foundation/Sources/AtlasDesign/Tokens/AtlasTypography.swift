import SwiftUI

/// A type style is font + tracking + line spacing + casing, because a `Font`
/// alone cannot express tracking in SwiftUI and tracking is most of what
/// separates cockpit typography from default system text.
public struct AtlasTypeStyle: Sendable {
    public let font: Font
    public let tracking: CGFloat
    public let lineSpacing: CGFloat
    public let uppercased: Bool

    public init(font: Font, tracking: CGFloat = 0, lineSpacing: CGFloat = 0, uppercased: Bool = false) {
        self.font = font
        self.tracking = tracking
        self.lineSpacing = lineSpacing
        self.uppercased = uppercased
    }
}

/// Atlas Ascend type scale.
///
/// Two ideas carry the automotive feel:
///
/// - **Display type tightens, label type opens.** Large sizes get negative
///   tracking so headlines read as one confident mass; small labels get wide
///   positive tracking and uppercase, the way instrument-cluster legends do.
/// - **Anything that changes uses tabular figures.** Speed, ETA, distance, and
///   odometer readings must not reflow as digits change. `.telemetry` and
///   `.readout` are monospaced-digit for exactly this reason — jittering
///   numbers destroy the illusion of precision instantly.
public enum AtlasType {

    // MARK: Display

    /// Reserved for a single hero number or word per screen.
    public static let display = AtlasTypeStyle(
        font: .system(size: 48, weight: .semibold, design: .default),
        tracking: -1.6
    )

    /// Screen titles.
    public static let title = AtlasTypeStyle(
        font: .system(size: 32, weight: .semibold),
        tracking: -0.8
    )

    /// Section headings.
    public static let heading = AtlasTypeStyle(
        font: .system(size: 24, weight: .semibold),
        tracking: -0.4
    )

    /// Card titles, list leads.
    public static let subheading = AtlasTypeStyle(
        font: .system(size: 19, weight: .medium),
        tracking: -0.2
    )

    // MARK: Body

    public static let body = AtlasTypeStyle(
        font: .system(size: 16, weight: .regular),
        lineSpacing: 4
    )

    public static let bodyEmphasis = AtlasTypeStyle(
        font: .system(size: 16, weight: .medium),
        lineSpacing: 4
    )

    public static let callout = AtlasTypeStyle(
        font: .system(size: 15, weight: .medium)
    )

    // MARK: Labels

    public static let label = AtlasTypeStyle(
        font: .system(size: 13, weight: .medium),
        tracking: 0.3
    )

    public static let caption = AtlasTypeStyle(
        font: .system(size: 12, weight: .medium),
        tracking: 0.2
    )

    /// The cockpit legend: small, uppercase, widely tracked. Used for field
    /// labels, section eyebrows, and unit descriptors. This single style does
    /// more for the automotive feel than any other in the scale.
    public static let eyebrow = AtlasTypeStyle(
        font: .system(size: 10, weight: .semibold),
        tracking: 1.8,
        uppercased: true
    )

    // MARK: Telemetry — live values, tabular figures

    /// Large live value: current speed, primary ETA.
    public static let telemetry = AtlasTypeStyle(
        font: .system(size: 40, weight: .medium).monospacedDigit(),
        tracking: -1.0
    )

    /// Medium live value: distance remaining, trip odometer.
    public static let readout = AtlasTypeStyle(
        font: .system(size: 22, weight: .medium).monospacedDigit(),
        tracking: -0.3
    )

    /// Small live value: inline metrics inside cards and pills.
    public static let readoutSmall = AtlasTypeStyle(
        font: .system(size: 15, weight: .medium).monospacedDigit()
    )
}

// MARK: - Application

private struct AtlasTypeModifier: ViewModifier {
    let style: AtlasTypeStyle

    func body(content: Content) -> some View {
        content
            .font(style.font)
            .tracking(style.tracking)
            .lineSpacing(style.lineSpacing)
            .textCase(style.uppercased ? .uppercase : nil)
    }
}

extension View {
    /// Apply an Atlas type style. Prefer this over raw `.font(...)` everywhere —
    /// it is what keeps tracking and casing consistent across the app.
    public func atlasType(_ style: AtlasTypeStyle) -> some View {
        modifier(AtlasTypeModifier(style: style))
    }
}

extension Atlas {
    public typealias TypeScale = AtlasType
}
