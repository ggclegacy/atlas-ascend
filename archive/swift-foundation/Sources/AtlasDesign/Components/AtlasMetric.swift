import SwiftUI

/// A telemetry readout: legend, value, unit.
///
/// The value uses tabular figures and the unit is typographically subordinate —
/// smaller, dimmer, and baseline-aligned rather than centered. Instrument
/// clusters treat the number as the subject and the unit as an annotation, and
/// copying that hierarchy is most of what makes a metric feel automotive.
public struct AtlasMetric: View {

    public enum Size: Sendable {
        /// Hero value — one per screen.
        case large
        /// Standard card metric.
        case medium
        /// Inline metric inside a dense row.
        case small
    }

    private let label: String
    private let value: String
    private let unit: String?
    private let size: Size
    private let tint: Color

    public init(
        label: String,
        value: String,
        unit: String? = nil,
        size: Size = .medium,
        tint: Color = AtlasColor.textPrimary
    ) {
        self.label = label
        self.value = value
        self.unit = unit
        self.size = size
        self.tint = tint
    }

    private var valueStyle: AtlasTypeStyle {
        switch size {
        case .large: AtlasType.telemetry
        case .medium: AtlasType.readout
        case .small: AtlasType.readoutSmall
        }
    }

    private var unitStyle: AtlasTypeStyle {
        switch size {
        case .large: AtlasType.label
        case .medium: AtlasType.caption
        case .small: AtlasType.eyebrow
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: size == .large ? AtlasSpace.xs : AtlasSpace.xxs) {
            AtlasEyebrow(label, showsTick: size == .large)

            // Baseline alignment keeps the unit sitting on the number's
            // baseline rather than floating at its vertical center.
            HStack(alignment: .firstTextBaseline, spacing: AtlasSpace.xxs) {
                Text(value)
                    .atlasType(valueStyle)
                    .foregroundStyle(tint)
                    .contentTransition(.numericText())

                if let unit {
                    Text(unit)
                        .atlasType(unitStyle)
                        .foregroundStyle(AtlasColor.textTertiary)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(unit.map { "\(value) \($0)" } ?? value)
    }
}
