import SwiftUI
import AtlasDesign

/// The user location puck.
///
/// Lives in `AtlasMap` rather than inside a provider so the Mapbox
/// implementation renders the identical puck — the puck is product identity and
/// must not change appearance when the underlying map vendor does.
///
/// Composition, back to front: a breathing accuracy halo, a heading cone, a
/// violet core, and a fine gold ring. The gold ring is the detail that makes it
/// read as a machined object rather than a blue dot.
public struct MapUserPuck: View {
    private let heading: Double
    private let isLive: Bool

    @State private var breathing = false

    public init(heading: Double = 0, isLive: Bool = true) {
        self.heading = heading
        self.isLive = isLive
    }

    public var body: some View {
        ZStack {
            Circle()
                .fill(AtlasViolet.halo)
                .frame(width: 120, height: 120)
                .scaleEffect(breathing ? 1.0 : 0.72)
                .opacity(breathing ? 0.35 : 0.7)

            // Heading cone. Only shown with a live heading — drawing a
            // direction we do not actually know would be a small lie with
            // real consequences while driving.
            if isLive {
                MapHeadingCone()
                    .fill(
                        LinearGradient(
                            colors: [
                                AtlasColor.violetElectric.opacity(0.55),
                                AtlasColor.violetElectric.opacity(0.0),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(width: 64, height: 52)
                    .offset(y: -26)
                    .rotationEffect(.degrees(heading))
            }

            Circle()
                .fill(
                    RadialGradient(
                        colors: [AtlasColor.violetHalo, AtlasColor.violetCore],
                        center: .init(x: 0.35, y: 0.3),
                        startRadius: 1,
                        endRadius: 14
                    )
                )
                .frame(width: 20, height: 20)

            Circle()
                .strokeBorder(AtlasGold.metallic, lineWidth: 1.5)
                .frame(width: 24, height: 24)
        }
        .frame(width: 120, height: 120)
        .onAppear {
            guard isLive else { return }
            withAnimation(AtlasMotion.ambient) { breathing = true }
        }
        .accessibilityLabel("Your location")
    }
}

/// Wedge shape for the heading indicator.
private struct MapHeadingCone: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY),
            control: CGPoint(x: rect.midX, y: rect.minY - rect.height * 0.22)
        )
        path.closeSubpath()
        return path
    }
}
