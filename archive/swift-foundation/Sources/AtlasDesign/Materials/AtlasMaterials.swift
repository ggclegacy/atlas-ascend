import SwiftUI

// MARK: - Gold as a material

/// Gold treatments.
///
/// A flat gold fill reads as yellow plastic. Real metal has a shadow side, a
/// body, a lit face, and a narrow specular band where the light source crosses
/// it. These gradients encode exactly that, which is why gold in Atlas Ascend
/// looks like an anodized trim piece rather than a highlight color.
public enum AtlasGold {

    /// Primary metallic sweep. The specular band sits just past center and is
    /// deliberately narrow — a wide highlight looks like a gradient, a narrow
    /// one looks like light catching an edge.
    public static let metallic = LinearGradient(
        stops: [
            .init(color: AtlasColor.goldShadow, location: 0.00),
            .init(color: AtlasColor.goldCore, location: 0.28),
            .init(color: AtlasColor.goldBright, location: 0.46),
            .init(color: AtlasColor.goldSpecular, location: 0.52),
            .init(color: AtlasColor.goldBright, location: 0.58),
            .init(color: AtlasColor.goldCore, location: 0.76),
            .init(color: AtlasColor.goldShadow, location: 1.00),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Horizontal variant for wide, short elements (rules, progress tracks).
    public static let metallicHorizontal = LinearGradient(
        stops: [
            .init(color: AtlasColor.goldShadow, location: 0.00),
            .init(color: AtlasColor.goldCore, location: 0.22),
            .init(color: AtlasColor.goldSpecular, location: 0.50),
            .init(color: AtlasColor.goldCore, location: 0.78),
            .init(color: AtlasColor.goldShadow, location: 1.00),
        ],
        startPoint: .leading,
        endPoint: .trailing
    )

    /// A hairline rule that fades at both ends. Used for section dividers where
    /// a hard-stopped gold line would feel like a border rather than an accent.
    public static let hairlineFade = LinearGradient(
        stops: [
            .init(color: AtlasColor.gold.opacity(0), location: 0.00),
            .init(color: AtlasColor.gold.opacity(0.5), location: 0.5),
            .init(color: AtlasColor.gold.opacity(0), location: 1.00),
        ],
        startPoint: .leading,
        endPoint: .trailing
    )

    /// Stroke for an accented border — brighter at top-leading where light lands.
    public static let edge = LinearGradient(
        stops: [
            .init(color: AtlasColor.goldBright.opacity(0.85), location: 0.0),
            .init(color: AtlasColor.goldCore.opacity(0.45), location: 0.5),
            .init(color: AtlasColor.goldShadow.opacity(0.30), location: 1.0),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

// MARK: - Violet as intelligence

/// Violet treatments. Reserved for Atlas itself and for live system state.
public enum AtlasViolet {

    /// Ambient wash behind an active Atlas surface.
    public static let wash = LinearGradient(
        stops: [
            .init(color: AtlasColor.violetDeep.opacity(0.55), location: 0.0),
            .init(color: AtlasColor.violetAbyss.opacity(0.0), location: 1.0),
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Active stroke for a listening/thinking Atlas control.
    public static let edge = LinearGradient(
        stops: [
            .init(color: AtlasColor.violetHalo.opacity(0.9), location: 0.0),
            .init(color: AtlasColor.violetCore.opacity(0.5), location: 0.6),
            .init(color: AtlasColor.violetElectric.opacity(0.75), location: 1.0),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Radial halo for the location puck and live indicators.
    public static let halo = RadialGradient(
        stops: [
            .init(color: AtlasColor.violetElectric.opacity(0.45), location: 0.0),
            .init(color: AtlasColor.violetCore.opacity(0.18), location: 0.55),
            .init(color: AtlasColor.violetCore.opacity(0.0), location: 1.0),
        ],
        center: .center,
        startRadius: 0,
        endRadius: 60
    )
}

// MARK: - Surfaces

/// Elevation levels in the depth ladder. Each step lifts the fill and slightly
/// strengthens the edge, so hierarchy is legible without borders or shadows
/// doing the work alone.
public enum AtlasElevation: Sendable {
    /// The app canvas.
    case canvas
    /// A sheet or nav surface sitting on the canvas.
    case sheet
    /// A card resting on a sheet.
    case card
    /// A control or input.
    case control
    /// Translucent glass floating over the map. The only level that blurs
    /// what is behind it — because over the map, opacity would kill the
    /// spatial illusion the map exists to create.
    case glass

    var fill: Color {
        switch self {
        case .canvas: AtlasColor.graphite
        case .sheet: AtlasColor.slate
        case .card: AtlasColor.elevated
        case .control: AtlasColor.raised
        case .glass: AtlasColor.floating.opacity(0.62)
        }
    }

    var strokeOpacity: Double {
        switch self {
        case .canvas: 0.0
        case .sheet: 0.06
        case .card: 0.08
        case .control: 0.10
        case .glass: 0.16
        }
    }

    /// Whether the surface gets a specular line along its top edge. This is the
    /// single detail that makes a panel read as a physical material rather than
    /// a colored rectangle.
    var hasSheen: Bool {
        switch self {
        case .canvas: false
        default: true
        }
    }

    var usesBlur: Bool { self == .glass }
}

/// Renders an Atlas surface: graduated fill, hairline edge, and a top sheen.
private struct AtlasSurfaceModifier: ViewModifier {
    let elevation: AtlasElevation
    let radius: CGFloat
    let accented: Bool

    func body(content: Content) -> some View {
        content.background {
            ZStack {
                // Blur only for glass — everywhere else an opaque fill keeps
                // scrolling cheap. Blur is expensive and the performance
                // standard outranks the visual flourish.
                if elevation.usesBlur {
                    AtlasRadius.shape(radius).fill(.ultraThinMaterial)
                }

                // Graduated fill: marginally lighter at the top, as though lit
                // from above. Flat fills are what make dark UI look inert.
                AtlasRadius.shape(radius).fill(
                    LinearGradient(
                        colors: [
                            elevation.fill.opacity(elevation.usesBlur ? 0.72 : 1.0),
                            elevation.fill.opacity(elevation.usesBlur ? 0.52 : 0.86),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

                // Edge.
                AtlasRadius.shape(radius).strokeBorder(
                    accented ? AnyShapeStyle(AtlasGold.edge)
                             : AnyShapeStyle(Color.white.opacity(elevation.strokeOpacity)),
                    lineWidth: accented ? 1 : 0.5
                )

                // Top-edge specular line.
                if elevation.hasSheen {
                    AtlasRadius.shape(radius)
                        .strokeBorder(
                            LinearGradient(
                                stops: [
                                    .init(color: AtlasColor.sheen.opacity(0.5), location: 0.0),
                                    .init(color: .clear, location: 0.35),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            ),
                            lineWidth: 0.5
                        )
                        .blendMode(.plusLighter)
                }
            }
        }
        .clipShape(AtlasRadius.shape(radius))
    }
}

extension View {
    /// Apply an Atlas surface material.
    /// - Parameter accented: use the gold edge instead of a neutral hairline.
    ///   Reserve for the one element on a screen that deserves emphasis.
    public func atlasSurface(
        _ elevation: AtlasElevation,
        radius: CGFloat = AtlasRadius.md,
        accented: Bool = false
    ) -> some View {
        modifier(AtlasSurfaceModifier(elevation: elevation, radius: radius, accented: accented))
    }
}

// MARK: - Scrims

/// Gradient scrims for floating UI over imagery or the map.
///
/// A solid bar over a map severs the spatial illusion. A scrim keeps the map
/// continuous underneath while still guaranteeing text contrast — this is the
/// mechanism that lets the map run genuinely full-bleed.
public enum AtlasScrim {

    public static let top = LinearGradient(
        stops: [
            .init(color: .black.opacity(0.78), location: 0.0),
            .init(color: .black.opacity(0.45), location: 0.45),
            .init(color: .black.opacity(0.0), location: 1.0),
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    public static let bottom = LinearGradient(
        stops: [
            .init(color: .black.opacity(0.0), location: 0.0),
            .init(color: .black.opacity(0.55), location: 0.42),
            .init(color: .black.opacity(0.92), location: 1.0),
        ],
        startPoint: .top,
        endPoint: .bottom
    )
}
