/**
 * The Atlas mark: stacked ascending chevrons.
 *
 * The trailing chevron is smaller and dimmer, reading as upward motion — the
 * "Ascend" in the name. Drawn as SVG rather than shipped as an image so it
 * inherits the metallic gold gradient and stays crisp at any size.
 */
export function AtlasMark({
  size = 24,
  active = false,
  className,
}: {
  size?: number;
  active?: boolean;
  className?: string;
}) {
  // Unique gradient id per size avoids collisions when several marks render
  // at once in the same document.
  const gradientId = `atlas-mark-gold-${size}`;

  return (
    <span
      className={className}
      style={{
        position: "relative",
        display: "inline-grid",
        placeItems: "center",
        width: size,
        height: size,
      }}
    >
      {/* Violet presence when Atlas is engaged — the app's tell that the
          intelligence layer is awake. */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          width: size * 2.1,
          height: size * 2.1,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(139,92,246,0.45), transparent 70%)",
          opacity: active ? 1 : 0,
          transition: "opacity 420ms cubic-bezier(0.2,0.8,0.25,1)",
          pointerEvents: "none",
        }}
      />
      <svg
        width={size}
        height={size}
        viewBox="0 0 26 26"
        role="img"
        aria-label="Atlas"
        style={{ position: "relative" }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#664b18" />
            <stop offset="28%" stopColor="#956e24" />
            <stop offset="46%" stopColor="#c4912f" />
            <stop offset="52%" stopColor="#f6e7be" />
            <stop offset="58%" stopColor="#deb25e" />
            <stop offset="76%" stopColor="#956e24" />
            <stop offset="100%" stopColor="#664b18" />
          </linearGradient>
        </defs>
        <path
          d="M4 12 L13 4 L22 12"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M7.5 21.5 L13 16.5 L18.5 21.5"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.5"
        />
      </svg>
    </span>
  );
}
