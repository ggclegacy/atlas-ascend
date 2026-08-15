// Xcode previews for the Command Center.
//
// Guarded by `ATLAS_CLI_BUILD` because the `#Preview` macro plugin ships with
// Xcode, not with the Command Line Tools. `Scripts/verify.sh` defines that flag
// so the package still builds and tests from a terminal on a machine without a
// full Xcode install; inside Xcode the flag is absent and previews work
// normally with no extra setup.
#if DEBUG && !ATLAS_CLI_BUILD

import SwiftUI
import AtlasDesign
import AtlasMap

#Preview("Command Center — idle") {
    CommandCenterView(model: .sample())
        .environment(\.mapProvider, PlaceholderMapProvider())
}

#Preview("Command Center — Atlas listening") {
    let model = CommandCenterModel.sample()
    model.atlasState = .listening
    return CommandCenterView(model: model)
        .environment(\.mapProvider, PlaceholderMapProvider())
}

#Preview("Command Center — overview") {
    let model = CommandCenterModel.sample()
    model.perspective = .overview
    return CommandCenterView(model: model)
        .environment(\.mapProvider, PlaceholderMapProvider())
}

/// No vehicle and no location — the true cold-start state for a new install.
/// Worth previewing deliberately: it is the first thing every user sees, and
/// it is the state most likely to be neglected.
#Preview("Command Center — cold start") {
    let model = CommandCenterModel(
        configuration: MapConfiguration(
            camera: MapCamera(center: MapCoordinate(latitude: 30.2672, longitude: -97.7431)),
            showsUserLocation: false
        ),
        vehicle: nil,
        destinations: [],
        speed: nil,
        tripDistance: nil,
        locationSource: .unavailable,
        vehicleSource: .unavailable,
        atlasSource: .unavailable
    )
    return CommandCenterView(model: model)
        .environment(\.mapProvider, PlaceholderMapProvider())
}

#endif
