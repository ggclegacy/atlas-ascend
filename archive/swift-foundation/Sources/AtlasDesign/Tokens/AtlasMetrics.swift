import SwiftUI

/// Spacing scale on a 4pt grid.
///
/// Generous spacing is most of what separates a premium interface from a dense
/// utility one. When in doubt between two steps, take the larger — the failure
/// mode of this product is cramped, not airy.
public enum AtlasSpace {
    /// 2 — optical nudges only.
    public static let hairline: CGFloat = 2
    /// 4 — inside a tight pill.
    public static let xxs: CGFloat = 4
    /// 8 — icon to its label.
    public static let xs: CGFloat = 8
    /// 12 — between related rows.
    public static let sm: CGFloat = 12
    /// 16 — default internal padding.
    public static let md: CGFloat = 16
    /// 20 — comfortable card padding.
    public static let lg: CGFloat = 20
    /// 24 — screen horizontal margin.
    public static let xl: CGFloat = 24
    /// 32 — between distinct groups.
    public static let xxl: CGFloat = 32
    /// 44 — between major sections.
    public static let xxxl: CGFloat = 44
    /// 64 — top-of-screen breathing room.
    public static let huge: CGFloat = 64

    /// Standard screen side margin.
    public static let screenMargin: CGFloat = 24
    /// Minimum tap target. Non-negotiable — enforced on every control.
    public static let tapTarget: CGFloat = 44
}

/// Corner radii.
///
/// Atlas Ascend uses continuous (squircle) curvature throughout. The difference
/// between `.circular` and `.continuous` at these radii is subtle in isolation
/// and obvious in aggregate — continuous is what reads as considered hardware.
public enum AtlasRadius {
    public static let xs: CGFloat = 6
    public static let sm: CGFloat = 10
    public static let md: CGFloat = 14
    public static let lg: CGFloat = 20
    public static let xl: CGFloat = 28
    /// Floating glass over the map.
    public static let floating: CGFloat = 24
    /// Sheets and drawers.
    public static let sheet: CGFloat = 32

    /// Continuous-curvature shape at a given radius.
    public static func shape(_ radius: CGFloat) -> RoundedRectangle {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
    }
}
