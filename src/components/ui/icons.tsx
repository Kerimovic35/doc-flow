/**
 * Symbole als Inline-SVG.
 *
 * Bewusst keine Symbol-Bibliothek: Die Anwendung braucht eine Handvoll
 * Symbole, eine Abhaengigkeit dafuer waere unverhaeltnismaessig und wuerde
 * die erste Ladezeit auf dem Smartphone verlaengern.
 */
interface IconProps {
  className?: string;
}

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M9.75 20v-5.5h4.5V20" />
    </svg>
  );
}

export function DocumentIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z" />
      <path d="M14 3v3.5A1.5 1.5 0 0 0 15.5 8H18" />
      <path d="M9 12.5h6M9 16h4" />
    </svg>
  );
}

export function TaskIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <rect x="4" y="4.5" width="16" height="15.5" rx="2" />
      <path d="M8 3v3M16 3v3M4 9.5h16" />
      <path d="m9 14.5 2 2 4-4" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

/** Der KI-Assistent: Sprechblase mit Funken. */
export function SparkIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M20 12.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2.5V12.5A7.5 7.5 0 0 1 11.5 5h1A7.5 7.5 0 0 1 20 12.5Z" />
      <path d="M12 8.5 12.9 11l2.6.9-2.6.9-.9 2.6-.9-2.6L8.5 12l2.6-.9z" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function PersonIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
    </svg>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />
    </svg>
  );
}

export function PaymentIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 14.5h3" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.9 7.5l1.9 1.1M17.2 15.4l1.9 1.1M4.9 16.5l1.9-1.1M17.2 8.6l1.9-1.1" />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3.5.8 5 1.5 6h-14c.7-1 1.5-2.5 1.5-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function CameraIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2.5l1.2-2h6.6l1.2 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function WarningIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4M12 16.8v.2" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}
