import SwiftUI

/// Maturity of a map provider implementation.
///
/// This exists so the app can tell the truth about itself at runtime. A
/// provider that is not `.production` must be visibly labeled in the UI —
/// nobody should ever look at a screenshot and be unsure whether the map is
/// real.
public enum MapProviderMaturity: Sendable {
    /// Real vendor SDK, real tiles, real geography.
    case production
    /// Renders a credible surface for composition and layout work, but shows
    /// no real geography and resolves no real coordinates.
    case developmentPlaceholder
}

/// Renders the map surface.
///
/// The entire vendor relationship passes through this one protocol. Mapbox is
/// the intended production provider, but nothing above this line may import
/// Mapbox — that is what makes the vendor swappable if licensing, pricing, or
/// platform support ever forces the issue.
///
/// Providers are `@MainActor` because every map SDK worth using owns a view and
/// demands main-thread access.
@MainActor
public protocol MapProvider {
    /// Stable identifier, e.g. `"mapbox"`. Used in diagnostics.
    var identifier: String { get }

    /// Whether this provider draws real geography. Drives the UI's honesty badge.
    var maturity: MapProviderMaturity { get }

    /// The map view itself.
    func makeMapView(configuration: Binding<MapConfiguration>) -> AnyView

    /// Move the camera. Providers that animate natively should honor
    /// `transition` rather than letting SwiftUI animate a coordinate, which
    /// produces linear interpolation across the globe instead of a proper flight.
    func moveCamera(to camera: MapCamera, transition: MapCameraTransition)
}

// MARK: - Environment wiring

private struct MapProviderKey: @preconcurrency EnvironmentKey {
    @MainActor static let defaultValue: any MapProvider = PlaceholderMapProvider()
}

extension EnvironmentValues {
    /// The active map provider. Injected at the app root so the whole tree —
    /// phone, CarPlay, previews — can be pointed at a different implementation
    /// without touching feature code.
    public var mapProvider: any MapProvider {
        get { self[MapProviderKey.self] }
        set { self[MapProviderKey.self] = newValue }
    }
}
