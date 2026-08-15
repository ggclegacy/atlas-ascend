import SwiftUI
import AtlasMap
import AtlasCommandCenter

/// Atlas Ascend — iOS app entry point.
///
/// ⚠️ NOT YET IN AN XCODE PROJECT. No `.xcodeproj` exists in this repository
/// because Xcode is not installed on the development machine. This file is
/// written and ready; creating the project and adding it is the first step once
/// Xcode is available. See `README.md` → "Bringing up the iOS app".
///
/// The root's only real job today is choosing the map provider. That single
/// injection point is what will later let CarPlay, previews, and tests each run
/// against a different implementation without any feature code changing.
@main
struct AtlasAscendApp: App {
    @State private var mapProvider: any MapProvider = AtlasAscendApp.makeMapProvider()

    var body: some Scene {
        WindowGroup {
            CommandCenterView(model: .sample())
                .environment(\.mapProvider, mapProvider)
                .preferredColorScheme(.dark)
        }
    }

    /// Selects the map provider.
    ///
    /// ⚠️ Currently always returns the placeholder. When the Mapbox SDK is
    /// added this becomes a real choice — production Mapbox by default, with
    /// the placeholder retained for previews and UI tests so neither burns
    /// tiles or requires network access.
    private static func makeMapProvider() -> any MapProvider {
        PlaceholderMapProvider()
    }
}
