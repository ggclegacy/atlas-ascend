import SwiftUI
import AtlasDesign

/// ⚠️ DEVELOPMENT PLACEHOLDER — NOT A MAP.
///
/// This provider renders an abstract perspective grid. It shows no real
/// geography, resolves no coordinates, and knows nothing about the world. It
/// exists for exactly one reason: to let the Command Center's composition,
/// scrims, typography, and controls be designed and reviewed before the Mapbox
/// SDK is integrated.
///
/// The grid is deliberately schematic rather than an imitation of streets. Any
/// surface that *looked* like a real map here would be a lie the moment someone
/// screenshotted it — so it reads unmistakably as a wireframe, and
/// `maturity` reports `.developmentPlaceholder` so the UI can badge it.
///
/// **Replace with `MapboxMapProvider`.** See `MAPBOX_INTEGRATION.md`.
@MainActor
public final class PlaceholderMapProvider: MapProvider {
    public let identifier = "placeholder"
    public let maturity: MapProviderMaturity = .developmentPlaceholder

    public init() {}

    public func makeMapView(configuration: Binding<MapConfiguration>) -> AnyView {
        AnyView(PlaceholderMapSurface(configuration: configuration))
    }

    public func moveCamera(to camera: MapCamera, transition: MapCameraTransition) {
        // No-op: there is no camera to move. The real provider drives the
        // vendor SDK's camera here.
    }
}

private struct PlaceholderMapSurface: View {
    @Binding var configuration: MapConfiguration
    @State private var horizonPulse = false

    /// Perspective strength, driven by the requested pitch so the placeholder
    /// at least responds to perspective changes the way the real map will.
    private var horizonFraction: CGFloat {
        // Pitch 0 (top-down) pushes the horizon off-screen; pitch 62 puts it
        // about a third of the way down.
        let pitch = configuration.perspective.pitch
        return CGFloat(0.02 + (pitch / 90.0) * 0.36)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                base
                Canvas { context, size in
                    drawGround(in: &context, size: size)
                }
                .drawingGroup() // Rasterize once; the grid is static per layout.

                horizonGlow(in: geo.size)
            }
            .animation(AtlasMotion.cinematic, value: configuration.perspective)
        }
        .background(AtlasColor.obsidian)
        .onAppear {
            withAnimation(AtlasMotion.ambient) { horizonPulse = true }
        }
        .accessibilityLabel("Map placeholder — no real geography")
    }

    private var base: some View {
        LinearGradient(
            stops: [
                .init(color: AtlasColor.violetAbyss, location: 0.0),
                .init(color: AtlasColor.graphite, location: horizonFraction),
                .init(color: AtlasColor.obsidian, location: 1.0),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// A soft violet band centered on the horizon. Reads as distant city light
    /// and gives the flat grid a sense of depth and atmosphere.
    private func horizonGlow(in size: CGSize) -> some View {
        let bandHeight: CGFloat = 220
        let horizonY = size.height * horizonFraction

        return VStack(spacing: 0) {
            Color.clear.frame(height: max(0, horizonY - bandHeight / 2))
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0.0),
                    .init(color: AtlasColor.violetCore.opacity(0.26), location: 0.5),
                    .init(color: .clear, location: 1.0),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: bandHeight)
            Spacer(minLength: 0)
        }
        .opacity(horizonPulse ? 0.9 : 0.6)
        .blendMode(.plusLighter)
        .allowsHitTesting(false)
    }

    /// Draws the ground plane: a grid in one-point perspective converging on a
    /// vanishing point at the horizon, plus two gold "arterials".
    private func drawGround(in context: inout GraphicsContext, size: CGSize) {
        let horizonY = size.height * horizonFraction
        let vanishing = CGPoint(x: size.width / 2, y: horizonY)
        let lineColor = Color.white.opacity(0.075)

        // Radiating lines. Spread endpoints well past the screen edges so the
        // fan still fills the corners at the bottom of the frame.
        var radial = Path()
        let spread = size.width * 2.6
        let steps = 22
        for i in 0...steps {
            let t = CGFloat(i) / CGFloat(steps)
            let x = -spread / 2 + spread * t + size.width / 2
            radial.move(to: vanishing)
            radial.addLine(to: CGPoint(x: x, y: size.height))
        }
        context.stroke(radial, with: .color(lineColor), lineWidth: 0.75)

        // Transverse lines, compressed toward the horizon by a square law —
        // that curve is what actually sells perspective.
        var transverse = Path()
        let bands = 16
        for i in 1...bands {
            let t = CGFloat(i) / CGFloat(bands)
            let y = horizonY + (size.height - horizonY) * (t * t)
            transverse.move(to: CGPoint(x: 0, y: y))
            transverse.addLine(to: CGPoint(x: size.width, y: y))
        }
        context.stroke(transverse, with: .color(lineColor), lineWidth: 0.75)

        // Two gold arterials converging on the vanishing point. Sparse on
        // purpose: gold is an accent here exactly as it is everywhere else.
        var arterial = Path()
        arterial.move(to: vanishing)
        arterial.addLine(to: CGPoint(x: size.width * 0.18, y: size.height))
        arterial.move(to: vanishing)
        arterial.addLine(to: CGPoint(x: size.width * 0.86, y: size.height))
        context.stroke(
            arterial,
            with: .linearGradient(
                Gradient(colors: [
                    AtlasColor.gold.opacity(0.0),
                    AtlasColor.gold.opacity(0.34),
                ]),
                startPoint: CGPoint(x: 0, y: horizonY),
                endPoint: CGPoint(x: 0, y: size.height)
            ),
            lineWidth: 1.5
        )

        // Horizon rule.
        var horizon = Path()
        horizon.move(to: CGPoint(x: 0, y: horizonY))
        horizon.addLine(to: CGPoint(x: size.width, y: horizonY))
        context.stroke(horizon, with: .color(AtlasColor.violetHalo.opacity(0.22)), lineWidth: 1)
    }
}
