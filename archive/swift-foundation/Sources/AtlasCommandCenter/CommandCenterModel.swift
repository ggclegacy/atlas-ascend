import SwiftUI
import Observation
import AtlasDesign
import AtlasMap

/// Where the values on screen come from.
///
/// This is load-bearing, not decoration. Atlas Ascend renders a simulation
/// badge whenever any pillar is not live, so nobody — including us — can
/// mistake a staged screen for a working one.
public enum DataSource: Sendable {
    /// Real sensor, service, or persisted user data.
    case live
    /// Hard-coded stand-in for layout and design review.
    case sample
    /// Genuinely unknown right now (permission denied, no fix, offline).
    /// Renders as an em-dash, never as a plausible-looking number.
    case unavailable
}

/// Atlas's conversational state on this surface.
public enum AtlasState: Equatable, Sendable {
    /// Waiting, showing its prompt.
    case idle
    /// Microphone engaged.
    case listening
    /// Working on a request.
    case thinking
}

/// A saved or suggested destination.
public struct QuickDestination: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let symbolName: String
    /// Driving time, pre-formatted. `nil` when not yet computed — the UI must
    /// handle absence rather than invent an ETA.
    public let eta: String?
    public let isPrimary: Bool

    public init(id: String, name: String, symbolName: String, eta: String?, isPrimary: Bool = false) {
        self.id = id
        self.name = name
        self.symbolName = symbolName
        self.eta = eta
        self.isPrimary = isPrimary
    }
}

/// The vehicle currently in context.
public struct VehicleSummary: Equatable, Sendable {
    public let name: String
    public let odometer: Int?
    public let hasServiceDue: Bool

    public init(name: String, odometer: Int?, hasServiceDue: Bool) {
        self.name = name
        self.odometer = odometer
        self.hasServiceDue = hasServiceDue
    }
}

/// State for the Command Center.
///
/// Deliberately holds no networking, no CoreLocation, and no LLM client. Those
/// arrive as injected services in later work; keeping them out now means this
/// screen stays previewable and testable, and means the seams are already in
/// the right places when the real implementations land.
@MainActor
@Observable
public final class CommandCenterModel {

    // MARK: Map

    public var configuration: MapConfiguration
    public var perspective: MapPerspective = .driving {
        didSet {
            configuration.perspective = perspective
            configuration.camera.pitch = perspective.pitch
        }
    }

    // MARK: Atlas

    public var atlasState: AtlasState = .idle

    // MARK: Context

    public var vehicle: VehicleSummary?
    public var destinations: [QuickDestination]

    // MARK: Telemetry

    /// Current speed in mph. `nil` renders as an em-dash rather than zero —
    /// "0 mph" and "no GPS fix" are different facts and must look different.
    public var speed: Int?
    public var tripDistance: Double?

    // MARK: Provenance

    public let locationSource: DataSource
    public let vehicleSource: DataSource
    public let atlasSource: DataSource

    /// True when anything on screen is not live. Drives the simulation badge.
    public var isSimulated: Bool {
        [locationSource, vehicleSource, atlasSource].contains { $0 != .live }
    }

    public init(
        configuration: MapConfiguration,
        vehicle: VehicleSummary?,
        destinations: [QuickDestination],
        speed: Int?,
        tripDistance: Double?,
        locationSource: DataSource,
        vehicleSource: DataSource,
        atlasSource: DataSource
    ) {
        self.configuration = configuration
        self.vehicle = vehicle
        self.destinations = destinations
        self.speed = speed
        self.tripDistance = tripDistance
        self.locationSource = locationSource
        self.vehicleSource = vehicleSource
        self.atlasSource = atlasSource
    }

    // MARK: Intents

    public func cyclePerspective() {
        let all = MapPerspective.allCases
        guard let index = all.firstIndex(of: perspective) else { return }
        withAnimation(AtlasMotion.cinematic) {
            perspective = all[(index + 1) % all.count]
        }
    }

    /// Toggles the microphone affordance.
    ///
    /// ⚠️ MOCKED: no speech recognizer is attached. This moves UI state only —
    /// it does not listen, transcribe, or reach any model. The real
    /// implementation replaces this body with a speech session and leaves the
    /// `AtlasState` contract unchanged.
    public func toggleListening() {
        withAnimation(AtlasMotion.considered) {
            atlasState = (atlasState == .listening) ? .idle : .listening
        }
    }
}

// MARK: - Sample data

extension CommandCenterModel {
    /// Design-review fixture. Every field is `.sample` or `.unavailable`, so a
    /// screen built from this always renders the simulation badge.
    public static func sample() -> CommandCenterModel {
        CommandCenterModel(
            configuration: MapConfiguration(
                camera: MapCamera(
                    center: MapCoordinate(latitude: 30.2672, longitude: -97.7431),
                    zoom: 16.4,
                    pitch: MapPerspective.driving.pitch,
                    bearing: 22
                ),
                showsUserLocation: true
            ),
            vehicle: VehicleSummary(name: "Range Rover", odometer: 48_312, hasServiceDue: true),
            destinations: [
                QuickDestination(id: "home", name: "Home", symbolName: "house.fill", eta: "18 min", isPrimary: true),
                QuickDestination(id: "work", name: "Work", symbolName: "building.2.fill", eta: "26 min"),
                QuickDestination(id: "fuel", name: "Fuel", symbolName: "fuelpump.fill", eta: "4 min"),
            ],
            speed: nil,          // No location services yet — must not show a number.
            tripDistance: nil,
            locationSource: .unavailable,
            vehicleSource: .sample,
            atlasSource: .sample
        )
    }
}
