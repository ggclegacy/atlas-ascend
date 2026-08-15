import SwiftUI

/// A geographic coordinate.
///
/// Deliberately Atlas's own type rather than `CLLocationCoordinate2D`. Feature
/// code, view models, and tests should never need to import CoreLocation or
/// Mapbox to talk about a place — that boundary is what keeps the map vendor
/// replaceable and the domain layer unit-testable off-device.
public struct MapCoordinate: Equatable, Hashable, Sendable {
    public let latitude: Double
    public let longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// Camera state for the map.
///
/// `pitch` is a first-class member rather than an afterthought because the
/// product identity depends on the map being spatial. A flat top-down camera is
/// the wrong default for Atlas Ascend.
public struct MapCamera: Equatable, Sendable {
    public var center: MapCoordinate
    /// Mapbox-convention zoom level, roughly 0 (world) to 22 (building).
    public var zoom: Double
    /// Degrees from vertical. 0 is top-down; the navigation default is ~60.
    public var pitch: Double
    /// Degrees clockwise from true north.
    public var bearing: Double

    public init(
        center: MapCoordinate,
        zoom: Double = 16,
        pitch: Double = 60,
        bearing: Double = 0
    ) {
        self.center = center
        self.zoom = zoom
        self.pitch = pitch
        self.bearing = bearing
    }
}

/// How the camera should move to a new state.
public enum MapCameraTransition: Sendable {
    /// No animation — for continuous location following, where animating each
    /// update would fight the incoming stream and look like drift.
    case immediate
    /// Standard eased move for user-initiated recentering.
    case standard
    /// Long, watchable flight. Reserved for context changes big enough to
    /// deserve one: starting a route, jumping to a saved destination.
    case cinematic
}

/// Map presentation modes.
public enum MapPerspective: String, CaseIterable, Sendable {
    /// Pitched 3D following the user's heading. The navigation default.
    case driving
    /// Pitched but north-locked.
    case oriented
    /// Flat top-down for surveying a route.
    case overview

    public var pitch: Double {
        switch self {
        case .driving: 62
        case .oriented: 45
        case .overview: 0
        }
    }

    public var symbolName: String {
        switch self {
        case .driving: "location.north.line.fill"
        case .oriented: "safari"
        case .overview: "map"
        }
    }

    public var displayName: String {
        switch self {
        case .driving: "Driving"
        case .oriented: "Oriented"
        case .overview: "Overview"
        }
    }
}

/// Identifies a map style. The production styles are custom Mapbox Studio
/// styles authored to the Atlas palette — a stock dark style will not match the
/// product and should not be shipped as though it does.
public enum MapStyleID: String, Sendable {
    /// The primary Atlas style: near-black land, violet-tinted water, gold
    /// arterial roads. Authored in Mapbox Studio. Not yet created.
    case atlasNight
    /// Higher-contrast variant for direct sunlight.
    case atlasDaylight
}

/// Something drawn on the map.
public struct MapAnnotation: Identifiable, Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        case userLocation(heading: Double)
        case destination
        case waypoint(index: Int)
        case savedPlace(symbolName: String)
    }

    public let id: String
    public let coordinate: MapCoordinate
    public let kind: Kind

    public init(id: String, coordinate: MapCoordinate, kind: Kind) {
        self.id = id
        self.coordinate = coordinate
        self.kind = kind
    }
}

/// Everything a provider needs to render a frame.
public struct MapConfiguration: Equatable, Sendable {
    public var camera: MapCamera
    public var style: MapStyleID
    public var perspective: MapPerspective
    public var annotations: [MapAnnotation]
    /// Whether the map shows the user's location puck. Gated on an authorized
    /// location permission — never assume it is granted.
    public var showsUserLocation: Bool

    public init(
        camera: MapCamera,
        style: MapStyleID = .atlasNight,
        perspective: MapPerspective = .driving,
        annotations: [MapAnnotation] = [],
        showsUserLocation: Bool = false
    ) {
        self.camera = camera
        self.style = style
        self.perspective = perspective
        self.annotations = annotations
        self.showsUserLocation = showsUserLocation
    }
}
