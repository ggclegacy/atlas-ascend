/**
 * Icon set.
 *
 * Hand-authored inline SVG rather than an icon library: the product needs
 * roughly fifteen glyphs, and shipping a dependency for that would cost more
 * bytes than the icons themselves. Everything inherits `currentColor` so tone
 * is controlled entirely by the design system.
 */

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({
  size = 18,
  className,
  children,
  filled = true,
}: IconProps & { children: React.ReactNode; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? undefined : "currentColor"}
      strokeWidth={filled ? undefined : 1.8}
      strokeLinecap={filled ? undefined : "round"}
      strokeLinejoin={filled ? undefined : "round"}
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const CarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h.5a1.5 1.5 0 0 1 1.5 1.5V17a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4.5A1.5 1.5 0 0 1 4.5 11H5zm2.2-.5h9.6l-1.1-3.2a.6.6 0 0 0-.6-.4H8.9a.6.6 0 0 0-.6.4L7.2 10.5zM6.5 14.2a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2zm11 0a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2z" />
  </Svg>
);

export const NavigationIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2L4.5 20.3l.9.7L12 17l6.6 4 .9-.7z" />
  </Svg>
);

export const CompassIcon = (p: IconProps) => (
  <Svg {...p} filled={false}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" />
  </Svg>
);

export const MapIcon = (p: IconProps) => (
  <Svg {...p} filled={false}>
    <path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 7z" />
    <path d="M9 4v13M15 7v12.5" />
  </Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p} filled={false}>
    <path d="M12 3l9 4.5-9 4.5-9-4.5z" />
    <path d="M3 12l9 4.5 9-4.5" />
    <path d="M3 16.5L12 21l9-4.5" />
  </Svg>
);

export const LocateIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 3h-2.06A7 7 0 0 0 13 5.06V3h-2v2.06A7 7 0 0 0 5.06 11H3v2h2.06A7 7 0 0 0 11 18.94V21h2v-2.06A7 7 0 0 0 18.94 13H21v-2zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" />
  </Svg>
);

export const MicIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z" />
  </Svg>
);

export const MicOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.3 2L2 3.3l7 7V11a3 3 0 0 0 4.5 2.6l1.5 1.5A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 3.2-1.3l3.5 3.5 1.3-1.3zM15 11V6a3 3 0 0 0-5.9-.7L15 11.2z" />
  </Svg>
);

export const WaveformIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10v4h2v-4H3zm4-4v12h2V6H7zm4-3v18h2V3h-2zm4 3v12h2V6h-2zm4 4v4h2v-4h-2z" />
  </Svg>
);

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3L2 12h3v8h6v-5h2v5h6v-8h3z" />
  </Svg>
);

export const WorkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 21V7l7-4v4l7-3v17H3zm2-2h4V7.6L5 9.2V19zm6 0h6V6.9l-6 2.6V19z" />
  </Svg>
);

export const FuelIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3h8a2 2 0 0 1 2 2v15H3V5a2 2 0 0 1 2-2zm0 4v4h8V7H5zm12 1.5l2.5 2.5V18a1 1 0 0 0 2 0v-7.6L18.4 7 17 8.5z" />
  </Svg>
);

export const StarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2l2.9 6.3 6.8.8-5 4.7 1.3 6.8L12 17.3 6 20.6l1.3-6.8-5-4.7 6.8-.8z" />
  </Svg>
);

export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p} filled={false}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 1.9" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p} filled={false}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.8-3.8" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p} filled={false}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p} filled={false}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p} filled={false}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const WarningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2L1 21h22L12 2zm0 6l7 12H5l7-12zm-1 3v4h2v-4h-2zm0 5v2h2v-2h-2z" />
  </Svg>
);

export const ARROW_BY_ORIGIN = {
  home: HomeIcon,
  work: WorkIcon,
  fuel: FuelIcon,
  charge: FuelIcon,
  food: PinIcon,
  star: StarIcon,
  pin: PinIcon,
  recent: ClockIcon,
} as const;
