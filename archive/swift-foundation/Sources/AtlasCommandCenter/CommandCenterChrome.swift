import SwiftUI
import AtlasDesign

// MARK: - Vehicle chip

/// The vehicle currently in context, anchored top-left.
///
/// Its presence on the map surface is a deliberate product statement: in Atlas
/// Ascend you are never just navigating, you are always driving a specific
/// vehicle, and trips, mileage, and service all attach to it. A maps app would
/// not need this control; a mobility system cannot work without it.
struct VehicleChip: View {
    let vehicle: VehicleSummary?
    let source: DataSource
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: AtlasSpace.sm) {
                ZStack {
                    Circle()
                        .fill(AtlasColor.raised)
                        .frame(width: 30, height: 30)
                    Image(systemName: "car.side.fill")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(AtlasColor.gold)
                }

                VStack(alignment: .leading, spacing: 1) {
                    Text(vehicle?.name ?? "Add vehicle")
                        .atlasType(AtlasType.callout)
                        .foregroundStyle(AtlasColor.textPrimary)
                        .lineLimit(1)

                    Text(odometerText)
                        .atlasType(AtlasType.eyebrow)
                        .foregroundStyle(AtlasColor.textTertiary)
                }

                if vehicle?.hasServiceDue == true {
                    Circle()
                        .fill(AtlasColor.caution)
                        .frame(width: 6, height: 6)
                }
            }
            .padding(.leading, AtlasSpace.xs)
            .padding(.trailing, AtlasSpace.md)
            .frame(height: 46)
            .atlasSurface(.glass, radius: AtlasRadius.lg)
        }
        .buttonStyle(.atlasPress)
        .accessibilityLabel(accessibilityText)
    }

    private var odometerText: String {
        guard let odometer = vehicle?.odometer, source != .unavailable else { return "—" }
        return "\(odometer.formatted(.number.grouping(.automatic))) mi"
    }

    private var accessibilityText: String {
        guard let vehicle else { return "Add a vehicle" }
        let service = vehicle.hasServiceDue ? ", service due" : ""
        return "\(vehicle.name), \(odometerText)\(service)"
    }
}

// MARK: - Telemetry

/// Live driving values, anchored bottom-left above the destination rail.
///
/// The `nil` handling is the important part. Without a location fix this shows
/// an em-dash and a "no signal" legend — never `0`. A speedometer reading zero
/// while you are moving is worse than one admitting it does not know.
struct TelemetryCluster: View {
    let speed: Int?
    let source: DataSource

    var body: some View {
        HStack(alignment: .bottom, spacing: AtlasSpace.lg) {
            AtlasMetric(
                label: source == .unavailable ? "No GPS" : "Speed",
                value: speed.map(String.init) ?? "—",
                unit: "mph",
                size: .large,
                tint: speed == nil ? AtlasColor.textTertiary : AtlasColor.textPrimary
            )
        }
        .shadow(color: .black.opacity(0.7), radius: 12, y: 4)
    }
}

// MARK: - Honesty badge

/// Renders what on this screen is not real.
///
/// Required by the product-integrity rule: staged data is fine during
/// development, silently staged data is not. This disappears on its own the
/// moment every source reports `.live`.
struct SimulationBadge: View {
    let locationSource: DataSource
    let vehicleSource: DataSource
    let atlasSource: DataSource
    let mapIsPlaceholder: Bool

    private var notes: [String] {
        var notes: [String] = []
        if mapIsPlaceholder { notes.append("Map placeholder") }
        if locationSource != .live { notes.append("No location") }
        if vehicleSource == .sample { notes.append("Sample vehicle") }
        if atlasSource != .live { notes.append("Atlas offline") }
        return notes
    }

    var body: some View {
        if notes.isEmpty {
            EmptyView()
        } else {
            HStack(spacing: AtlasSpace.xs) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(AtlasColor.caution)

                Text(notes.joined(separator: " · "))
                    .atlasType(AtlasType.eyebrow)
                    .foregroundStyle(AtlasColor.caution.opacity(0.9))
            }
            .padding(.horizontal, AtlasSpace.sm)
            .padding(.vertical, 6)
            .background {
                Capsule().fill(AtlasColor.obsidian.opacity(0.65))
                Capsule().strokeBorder(AtlasColor.caution.opacity(0.28), lineWidth: 0.5)
            }
            .accessibilityLabel("Development build. \(notes.joined(separator: ", "))")
        }
    }
}
