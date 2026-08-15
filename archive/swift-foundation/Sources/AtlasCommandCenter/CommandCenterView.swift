import SwiftUI
import AtlasDesign
import AtlasMap

/// The Command Center — Atlas Ascend's primary surface.
///
/// The central design decision: **the map is the screen, not a component on
/// it.** It runs edge to edge behind everything including the status bar and
/// home indicator, and every control floats above it on glass. Nothing is
/// allowed to box the map into a rectangle, because the moment it is boxed the
/// product reads as a dashboard that happens to contain a map rather than a
/// vehicle surface you are moving through.
///
/// Legibility over that full-bleed map comes from gradient scrims rather than
/// solid bars — a scrim keeps the map continuous underneath while still
/// guaranteeing contrast.
///
/// Layout, top to bottom:
/// - Top rail: vehicle context left, map controls right
/// - Center: the user puck
/// - Bottom: telemetry, saved destinations, and the Atlas prompt bar at thumb height
public struct CommandCenterView: View {
    @State private var model: CommandCenterModel
    @Environment(\.mapProvider) private var mapProvider

    public init(model: CommandCenterModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ZStack {
            mapLayer
            scrimLayer
            contentLayer
        }
        .background(AtlasColor.obsidian)
        #if os(iOS)
        .ignoresSafeArea(.container, edges: .all)
        .preferredColorScheme(.dark)
        #endif
    }

    // MARK: Map

    private var mapLayer: some View {
        ZStack {
            mapProvider.makeMapView(configuration: $model.configuration)

            // The puck sits at screen center in a following camera. When the
            // real provider lands it projects the coordinate instead; in
            // `.overview` there is no follow, so it is hidden rather than
            // pinned somewhere meaningless.
            if model.configuration.showsUserLocation && model.perspective != .overview {
                MapUserPuck(
                    heading: model.configuration.camera.bearing,
                    isLive: model.locationSource == .live
                )
                .offset(y: 40) // Bias below center: in a pitched camera the road
                               // ahead deserves more of the frame than behind.
            }
        }
        .allowsHitTesting(true)
    }

    // MARK: Scrims

    private var scrimLayer: some View {
        VStack(spacing: 0) {
            AtlasScrim.top.frame(height: 220)
            Spacer(minLength: 0)
            AtlasScrim.bottom.frame(height: 340)
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }

    // MARK: Content

    private var contentLayer: some View {
        VStack(spacing: 0) {
            topRail
            Spacer(minLength: 0)
            bottomStack
        }
        .padding(.horizontal, AtlasSpace.screenMargin)
        .padding(.top, AtlasSpace.xs)
        .padding(.bottom, AtlasSpace.md)
        #if os(iOS)
        .safeAreaPadding(.vertical)
        #endif
    }

    private var topRail: some View {
        VStack(alignment: .leading, spacing: AtlasSpace.sm) {
            HStack(alignment: .top, spacing: AtlasSpace.sm) {
                VehicleChip(
                    vehicle: model.vehicle,
                    source: model.vehicleSource,
                    action: {} // Vehicle Command Center — not built yet.
                )

                Spacer(minLength: AtlasSpace.xs)

                AtlasIconButton(
                    systemImage: model.perspective.symbolName,
                    label: "Map perspective: \(model.perspective.displayName)",
                    isActive: model.perspective != .overview,
                    action: { model.cyclePerspective() }
                )

                AtlasIconButton(
                    systemImage: "square.stack.3d.up",
                    label: "Map layers",
                    action: {} // Layer control — not built yet.
                )
            }

            SimulationBadge(
                locationSource: model.locationSource,
                vehicleSource: model.vehicleSource,
                atlasSource: model.atlasSource,
                mapIsPlaceholder: mapProvider.maturity == .developmentPlaceholder
            )
        }
    }

    private var bottomStack: some View {
        VStack(alignment: .leading, spacing: AtlasSpace.md) {
            HStack(alignment: .bottom) {
                TelemetryCluster(speed: model.speed, source: model.locationSource)
                Spacer(minLength: 0)
                recenterButton
            }

            destinationRail
            promptBar
        }
    }

    private var recenterButton: some View {
        AtlasIconButton(
            systemImage: "location.fill",
            label: "Recenter on your location",
            isActive: false,
            action: {} // Requires a location service — not wired yet.
        )
    }

    /// Saved destinations. Horizontally scrollable so the rail can grow with
    /// learned places without ever wrapping into a second line and stealing
    /// vertical space from the map.
    private var destinationRail: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AtlasSpace.xs) {
                ForEach(model.destinations) { destination in
                    AtlasPill(
                        systemImage: destination.symbolName,
                        title: destination.name,
                        detail: destination.eta,
                        emphasis: destination.isPrimary ? .accented : .standard,
                        action: {} // Routing — not wired yet.
                    )
                }
            }
            .padding(.vertical, 2) // Room for the press scale to breathe.
        }
        .scrollClipDisabled()
    }

    private var promptBar: some View {
        AtlasPromptBar(
            state: model.atlasState,
            onTapField: {}, // Text entry to Atlas — not wired yet.
            onTapMic: { model.toggleListening() }
        )
    }
}
