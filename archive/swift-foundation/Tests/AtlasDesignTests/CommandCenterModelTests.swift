import Testing
@testable import AtlasCommandCenter
@testable import AtlasMap

/// Enforces the product-integrity rule mechanically rather than by discipline:
/// staged data must always announce itself, and the UI must never be handed a
/// fabricated sensor reading.
@Suite("Command Center model")
@MainActor
struct CommandCenterModelTests {

    @Test func sampleModelReportsItselfAsSimulated() {
        let model = CommandCenterModel.sample()
        #expect(model.isSimulated, "Sample data must always drive the simulation badge")
    }

    /// The sample fixture must not invent a speed. An em-dash is correct when
    /// there is no location fix; a plausible number is not.
    @Test func sampleModelDoesNotFabricateSensorReadings() {
        let model = CommandCenterModel.sample()
        #expect(model.speed == nil, "Speed must be nil without a location fix")
        #expect(model.tripDistance == nil, "Trip distance must be nil without a location fix")
        #expect(model.locationSource == .unavailable)
    }

    @Test func fullyLiveModelHidesSimulationBadge() {
        let model = CommandCenterModel(
            configuration: MapConfiguration(
                camera: MapCamera(center: MapCoordinate(latitude: 0, longitude: 0))
            ),
            vehicle: nil,
            destinations: [],
            speed: 42,
            tripDistance: 3.1,
            locationSource: .live,
            vehicleSource: .live,
            atlasSource: .live
        )
        #expect(model.isSimulated == false)
    }

    /// Cycling must visit every perspective and return to the start, so the
    /// single control can reach all three modes.
    @Test func perspectiveCycleIsExhaustiveAndWraps() {
        let model = CommandCenterModel.sample()
        let start = model.perspective
        var seen: Set<MapPerspective> = [start]

        for _ in 0..<(MapPerspective.allCases.count - 1) {
            model.cyclePerspective()
            seen.insert(model.perspective)
        }
        model.cyclePerspective()

        #expect(seen.count == MapPerspective.allCases.count)
        #expect(model.perspective == start, "Cycling must wrap to the start")
    }

    /// Changing perspective must actually move the camera pitch — the control
    /// is meaningless if the two drift apart.
    @Test func perspectiveDrivesCameraPitch() {
        let model = CommandCenterModel.sample()

        model.perspective = .overview
        #expect(model.configuration.camera.pitch == MapPerspective.overview.pitch)
        #expect(model.configuration.camera.pitch == 0, "Overview must be top-down")

        model.perspective = .driving
        #expect(model.configuration.camera.pitch == MapPerspective.driving.pitch)
        #expect(model.configuration.camera.pitch > 45, "Driving must be pitched")
    }

    @Test func toggleListeningIsReversible() {
        let model = CommandCenterModel.sample()
        #expect(model.atlasState == .idle)
        model.toggleListening()
        #expect(model.atlasState == .listening)
        model.toggleListening()
        #expect(model.atlasState == .idle)
    }

    /// The placeholder provider must never claim production maturity — the
    /// honesty badge depends on it telling the truth about itself.
    @Test func placeholderProviderDeclaresItselfNonProduction() {
        let provider = PlaceholderMapProvider()
        #expect(provider.maturity == .developmentPlaceholder)
    }
}
