import SwiftUI

// MARK: - Hex convenience

extension Color {
    /// 0xRRGGBB literal initializer. Internal on purpose — feature code should
    /// reference semantic tokens, never raw hex.
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

// MARK: - Palette

/// The Atlas Ascend color world: black, metallic gold, deep/electric violet.
///
/// Three rules govern this palette, and they are the difference between
/// "premium automotive" and "cheap dark-mode app":
///
/// 1. **Black is depth, not background.** Surfaces climb a ladder from true
///    OLED black upward, and each step gains a little violet. Elevation should
///    read as light gathering in the material, never as flat gray.
/// 2. **Gold is a material, not a color.** A flat fill of gold reads as yellow
///    UI chrome instantly. Real gold has a highlight, a body, and a shadow —
///    so the gold tokens here are gradient stops, and `Atlas.Color.gold` exists
///    only for hairlines and small text where a gradient would be noise.
/// 3. **Violet is reserved.** It means Atlas intelligence or a live/active
///    system state. Spending it on ordinary chrome is what makes purple UI look
///    like gaming decoration. Scarcity is the whole effect.
public enum AtlasColor {

    // MARK: Depth ladder

    /// True black. The base plane and anything that should disappear on OLED.
    public static let obsidian = Color(hex: 0x000000)
    /// The default app canvas — a hair off black so true black still reads as deeper.
    public static let graphite = Color(hex: 0x08080B)
    /// First lift. Sheets, nav surfaces.
    public static let slate = Color(hex: 0x101014)
    /// Second lift. Cards resting on a sheet.
    public static let elevated = Color(hex: 0x17171E)
    /// Third lift. Controls, pressed states, inputs.
    public static let raised = Color(hex: 0x1F1F28)
    /// Highest lift. Popovers, floating glass over the map.
    public static let floating = Color(hex: 0x282833)

    // MARK: Structure

    /// Hairline separators. Never use full-opacity white for rules.
    public static let hairline = Color(hex: 0xFFFFFF, opacity: 0.08)
    /// Slightly stronger rule for section boundaries.
    public static let rule = Color(hex: 0xFFFFFF, opacity: 0.14)
    /// The top-edge specular line that sells a surface as a physical material.
    public static let sheen = Color(hex: 0xFFFFFF, opacity: 0.22)

    // MARK: Gold — metallic accent

    /// Deep bronze. The shadow stop of the metallic gradient.
    public static let goldShadow = Color(hex: 0x6E5220)
    /// Body of the metal.
    public static let goldCore = Color(hex: 0xB08D33)
    /// The lit face.
    public static let goldBright = Color(hex: 0xD9B65B)
    /// Specular highlight — the glint. Used sparingly and never as a fill.
    public static let goldSpecular = Color(hex: 0xF3E3B0)
    /// Flat gold for hairlines, small caps labels, and iconography where a
    /// gradient would read as noise rather than material.
    public static let gold = Color(hex: 0xC9A544)
    /// Gold at low opacity for rules and inactive accent strokes.
    public static let goldHairline = Color(hex: 0xC9A544, opacity: 0.28)

    // MARK: Violet — intelligence

    /// Near-black violet. Ambient wash beneath Atlas surfaces.
    public static let violetAbyss = Color(hex: 0x140C26)
    /// Deep violet. Backgrounds of active/intelligent regions.
    public static let violetDeep = Color(hex: 0x2A1857)
    /// The working violet. Atlas's own color.
    public static let violetCore = Color(hex: 0x6437E0)
    /// Electric edge — active strokes, live indicators, the location puck.
    public static let violetElectric = Color(hex: 0x8B5CF6)
    /// Halo/glow. Only ever seen at low opacity, never as a fill.
    public static let violetHalo = Color(hex: 0xA98BFF)

    // MARK: Text

    /// Warm white. Deliberately not #FFFFFF — pure white on black is harsh and
    /// reads as cheap. This is the single most load-bearing choice in the palette.
    public static let textPrimary = Color(hex: 0xF4F2ED)
    /// Supporting copy, values that aren't the headline.
    public static let textSecondary = Color(hex: 0xA5A2AC)
    /// Labels, metadata, units.
    public static let textTertiary = Color(hex: 0x6B6874)
    /// Disabled, placeholder, decorative.
    public static let textQuaternary = Color(hex: 0x45424D)
    /// Text sitting on a gold fill.
    public static let textOnGold = Color(hex: 0x1A1204)

    // MARK: Semantic

    /// Healthy, complete, within spec. Muted on purpose — candy green is the
    /// fastest way to make a premium interface look like a consumer utility.
    public static let positive = Color(hex: 0x3FB98A)
    /// Service due soon, degraded, attention-not-alarm. Distinct from accent gold.
    public static let caution = Color(hex: 0xE0A64B)
    /// Overdue, fault, hard failure.
    public static let critical = Color(hex: 0xD9484E)
    /// Informational / system.
    public static let informative = Color(hex: 0x4A9EDB)
}

// MARK: - Namespace

/// Design-system entry point. Feature code says `Atlas.Color.gold`,
/// `Atlas.Type.eyebrow`, `Atlas.Space.lg` — one door into the system.
public enum Atlas {
    public typealias Color = AtlasColor
    public typealias Space = AtlasSpace
    public typealias Radius = AtlasRadius
    public typealias Motion = AtlasMotion
}
