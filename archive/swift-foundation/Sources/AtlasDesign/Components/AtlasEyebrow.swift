import SwiftUI

/// The cockpit legend: a small, uppercase, widely-tracked label, optionally
/// preceded by a short gold tick.
///
/// Used above values, sections, and fields throughout the product. The tick is
/// what turns a label into instrumentation — it reads as an index mark on a
/// gauge rather than as text sitting on a page.
public struct AtlasEyebrow: View {
    private let text: String
    private let showsTick: Bool
    private let tint: Color

    public init(_ text: String, showsTick: Bool = true, tint: Color = AtlasColor.textTertiary) {
        self.text = text
        self.showsTick = showsTick
        self.tint = tint
    }

    public var body: some View {
        HStack(spacing: AtlasSpace.xs) {
            if showsTick {
                Rectangle()
                    .fill(AtlasGold.metallicHorizontal)
                    .frame(width: 12, height: 1)
            }
            Text(text)
                .atlasType(AtlasType.eyebrow)
                .foregroundStyle(tint)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
    }
}

/// A full-width hairline rule that fades at both ends.
public struct AtlasDivider: View {
    private let gold: Bool

    public init(gold: Bool = false) {
        self.gold = gold
    }

    public var body: some View {
        Rectangle()
            .fill(gold ? AnyShapeStyle(AtlasGold.hairlineFade) : AnyShapeStyle(AtlasColor.hairline))
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}
