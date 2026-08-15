import SwiftUI

/// The Atlas mark: stacked ascending chevrons.
///
/// Two chevrons, the trailing one smaller and dimmer, reading as upward motion —
/// the "Ascend" in the name, and a form that survives being rendered at 16pt on
/// a watch face or 200pt on a launch screen.
///
/// Drawn as a shape rather than shipped as an asset so it inherits the metallic
/// gold gradient and scales without a raster round-trip.
public struct AtlasMark: View {
    private let size: CGFloat
    private let isActive: Bool

    public init(size: CGFloat = 24, isActive: Bool = false) {
        self.size = size
        self.isActive = isActive
    }

    public var body: some View {
        ZStack {
            // Violet presence behind the mark when Atlas is engaged. This is
            // the app's tell that the intelligence layer is awake.
            if isActive {
                Circle()
                    .fill(AtlasViolet.halo)
                    .frame(width: size * 2.2, height: size * 2.2)
            }

            VStack(spacing: size * 0.16) {
                AtlasChevron()
                    .stroke(AtlasGold.metallic, style: .init(lineWidth: size * 0.13, lineCap: .round, lineJoin: .round))
                    .frame(width: size * 0.82, height: size * 0.34)

                AtlasChevron()
                    .stroke(AtlasGold.metallic, style: .init(lineWidth: size * 0.13, lineCap: .round, lineJoin: .round))
                    .frame(width: size * 0.55, height: size * 0.23)
                    .opacity(0.5)
            }
            .frame(width: size, height: size)
        }
        .animation(AtlasMotion.considered, value: isActive)
        .accessibilityLabel("Atlas")
    }
}

/// A single upward chevron.
private struct AtlasChevron: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        return path
    }
}
