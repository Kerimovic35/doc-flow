import {
  DocumentIcon,
  FolderIcon,
  HomeIcon,
  PaymentIcon,
  PersonIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  TaskIcon,
} from '@/components/ui/icons';

export interface NavItem {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
}

/**
 * Die fuenf Ziele der mobilen Leiste.
 *
 * Bewusst genau fuenf: Mehr Eintraege werden auf einem iPhone-Bildschirm zu
 * schmal, um sie sicher zu treffen. Das Hinzufuegen eines Dokuments steht
 * nicht in der Leiste, sondern auf der schwebenden Schaltflaeche - es ist der
 * mit Abstand haeufigste Vorgang und verdient den groessten Knopf.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: '/start', label: 'Start', Icon: HomeIcon },
  { href: '/dokumente', label: 'Dokumente', Icon: DocumentIcon },
  { href: '/aufgaben', label: 'Aufgaben', Icon: TaskIcon },
  { href: '/suche', label: 'Suche', Icon: SearchIcon },
  { href: '/ki', label: 'KI', Icon: SparkIcon },
];

/** Weitere Bereiche, auf dem Desktop direkt in der Seitenleiste sichtbar. */
export const SECONDARY_NAV: NavItem[] = [
  { href: '/aufgaben?tab=zahlungen', label: 'Zahlungen', Icon: PaymentIcon },
  { href: '/einstellungen/personen', label: 'Personen', Icon: PersonIcon },
  { href: '/einstellungen/kategorien', label: 'Kategorien', Icon: FolderIcon },
  { href: '/einstellungen', label: 'Einstellungen', Icon: SettingsIcon },
];

/**
 * Markiert einen Eintrag als aktiv, auch auf Unterseiten:
 * /dokumente/abc soll "Dokumente" hervorheben.
 *
 * Ein Fragezeichen im Ziel (z. B. /aufgaben?tab=zahlungen) wird abgeschnitten -
 * verglichen wird immer nur der Pfad.
 */
export function isActive(pathname: string, href: string): boolean {
  const path = href.split('?')[0] ?? href;
  return pathname === path || pathname.startsWith(`${path}/`);
}
