import Testing
import SwiftUI
@testable import AtlasDesign

/// Guards design-system invariants that are easy to violate silently during a
/// refactor and expensive to notice by eye.
@Suite("Design system invariants")
struct AtlasDesignTests {

    /// The spacing scale must stay strictly increasing. A duplicated or
    /// out-of-order step makes the grid meaningless without producing any
    /// visible error.
    @Test func spacingScaleIsStrictlyIncreasing() {
        let scale: [CGFloat] = [
            AtlasSpace.hairline, AtlasSpace.xxs, AtlasSpace.xs, AtlasSpace.sm,
            AtlasSpace.md, AtlasSpace.lg, AtlasSpace.xl, AtlasSpace.xxl,
            AtlasSpace.xxxl, AtlasSpace.huge,
        ]
        for (a, b) in zip(scale, scale.dropFirst()) {
            #expect(a < b, "Spacing scale must be strictly increasing")
        }
    }

    /// Every step on the 4pt grid must actually be on the 4pt grid. The 2pt
    /// optical nudge is intentionally excluded as a half-step.
    @Test func spacingStepsAlignToGrid() {
        let gridSteps: [CGFloat] = [
            AtlasSpace.xxs, AtlasSpace.xs, AtlasSpace.sm, AtlasSpace.md,
            AtlasSpace.lg, AtlasSpace.xl, AtlasSpace.xxl, AtlasSpace.xxxl,
            AtlasSpace.huge, AtlasSpace.screenMargin,
        ]
        for step in gridSteps {
            #expect(
                step.truncatingRemainder(dividingBy: 4) == 0,
                "\(step) is off the 4pt grid"
            )
        }
    }

    /// Apple's HIG minimum. Non-negotiable, and doubly so in a product used
    /// while driving.
    @Test func tapTargetMeetsAccessibilityMinimum() {
        #expect(AtlasSpace.tapTarget >= 44)
    }

    /// The radius scale must stay ordered so elevation reads consistently.
    @Test func radiusScaleIsIncreasing() {
        let scale: [CGFloat] = [
            AtlasRadius.xs, AtlasRadius.sm, AtlasRadius.md,
            AtlasRadius.lg, AtlasRadius.xl, AtlasRadius.sheet,
        ]
        for (a, b) in zip(scale, scale.dropFirst()) {
            #expect(a < b, "Radius scale must be increasing")
        }
    }

    /// Only the eyebrow style is uppercased. If a second style ever starts
    /// shouting, that is a regression worth failing a build over.
    @Test func onlyEyebrowIsUppercased() {
        #expect(AtlasType.eyebrow.uppercased)
        let quiet = [
            AtlasType.display, AtlasType.title, AtlasType.heading,
            AtlasType.body, AtlasType.label, AtlasType.caption,
        ]
        for style in quiet {
            #expect(style.uppercased == false)
        }
    }

    /// Display type tightens, label type opens. This inversion is the core of
    /// the typographic identity.
    @Test func trackingDirectionMatchesScale() {
        #expect(AtlasType.display.tracking < 0, "Display type must tighten")
        #expect(AtlasType.title.tracking < 0, "Title type must tighten")
        #expect(AtlasType.eyebrow.tracking > 1, "Eyebrow must be widely tracked")
    }

    /// Elevation must climb monotonically. If two levels share a stroke
    /// strength the depth ladder stops communicating hierarchy.
    @Test func elevationStrokesClimbWithHeight() {
        let ladder: [AtlasElevation] = [.canvas, .sheet, .card, .control, .glass]
        for (a, b) in zip(ladder, ladder.dropFirst()) {
            #expect(a.strokeOpacity < b.strokeOpacity, "Elevation must climb")
        }
    }

    /// Only glass blurs. Blur is expensive, and the performance standard
    /// outranks the visual flourish everywhere the map is not behind it.
    @Test func onlyGlassUsesBlur() {
        #expect(AtlasElevation.glass.usesBlur)
        for level in [AtlasElevation.canvas, .sheet, .card, .control] {
            #expect(level.usesBlur == false, "\(level) must not blur")
        }
    }
}
