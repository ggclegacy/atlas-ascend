import SwiftUI

/// Motion vocabulary.
///
/// Every animation in Atlas Ascend names its intent rather than inventing a
/// duration at the call site. Five curves cover the product; if a sixth seems
/// necessary, the interaction is probably wrong.
///
/// The governing idea is **deliberate, never eager**. Nothing bounces. Springs
/// are damped close to critical so motion settles rather than wobbles — overshoot
/// reads as playful, and this product is not playful.
public enum AtlasMotion {

    /// 0.12s — press and release feedback. Must be imperceptibly fast.
    public static let instant = Animation.easeOut(duration: 0.12)

    /// 0.22s — routine state changes: selection, toggle, value swap.
    public static let swift = Animation.easeOut(duration: 0.22)

    /// Damped spring — elements entering, leaving, or repositioning.
    /// Damping 0.86 settles without visible overshoot.
    public static let considered = Animation.spring(response: 0.42, dampingFraction: 0.86)

    /// Heavier spring for sheets and drawers carrying real visual weight.
    public static let substantial = Animation.spring(response: 0.55, dampingFraction: 0.88)

    /// 0.8s — map camera moves and full-screen transitions. The one place
    /// slowness is the point: a cinematic camera move should be watchable.
    public static let cinematic = Animation.timingCurve(0.32, 0.72, 0.16, 1.0, duration: 0.8)

    /// Continuous breathing for live indicators — the location puck halo, an
    /// active Atlas listening state. Long and shallow so it registers as
    /// "alive" peripherally without ever demanding attention.
    public static let ambient = Animation.easeInOut(duration: 2.6).repeatForever(autoreverses: true)
}

// MARK: - Press feedback

/// Scales and dims a control on press. Applied by every Atlas control so
/// tactile response is uniform rather than per-component guesswork.
public struct AtlasPressStyle: ButtonStyle {
    private let scale: CGFloat

    public init(scale: CGFloat = 0.97) {
        self.scale = scale
    }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.82 : 1)
            .animation(AtlasMotion.instant, value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == AtlasPressStyle {
    /// `.buttonStyle(.atlasPress)`
    public static var atlasPress: AtlasPressStyle { AtlasPressStyle() }
}
