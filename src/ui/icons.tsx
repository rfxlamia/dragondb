/**
 * Shared inline SVG icon set.
 *
 * Inline (never a font or sprite sheet) so a strict-CSP / offline Tauri
 * artifact can never fail to draw chrome, matching the creative brief's
 * "bundle everything" rule for fonts. Every icon:
 *
 * - is drawn on a 16×16 grid with a 1.4px stroke, so weights match Inter's
 *   medium/semibold labels they sit next to;
 * - inherits `currentColor`, so a control's own state colors drive the icon;
 * - is `aria-hidden`, so the accessible name always comes from the button's
 *   text or `aria-label` (the copy constants stay the test contract).
 */

type IconProps = { size?: number };

function svgProps(size: number) {
  return {
    fill: "none" as const,
    focusable: false as const,
    height: size,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.4,
    viewBox: "0 0 16 16",
    width: size,
    xmlns: "http://www.w3.org/2000/svg",
  };
}

export function ChevronRightIcon({ size = 14 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 14 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M3.5 6 8 10.5 12.5 6" />
    </svg>
  );
}

/** Sort direction on a results column header. Replaces the `↑ ↓` text glyphs
 *  that `::after` content used to inject — a pseudo-element cannot be
 *  `aria-hidden`, so the arrow was announced on top of the `aria-sort` the
 *  header already carries. */
export function SortAscIcon({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M3.5 10 8 5.5 12.5 10" />
    </svg>
  );
}

export function SortDescIcon({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M3.5 6 8 10.5 12.5 6" />
    </svg>
  );
}

export function EllipsisIcon({ size = 16 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true" strokeWidth={0} fill="currentColor">
      <circle cx="4" cy="8" r="1.35" />
      <circle cx="8" cy="8" r="1.35" />
      <circle cx="12" cy="8" r="1.35" />
    </svg>
  );
}

export function SearchIcon({ size = 14 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <circle cx="7" cy="7" r="3.9" />
      <path d="M10 10l3 3" />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function CloseIcon({ size = 14 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function RefreshIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M13 6.5A5 5 0 1 0 12 11" />
      <path d="M13 3v3.5h-3.4" />
    </svg>
  );
}

export function SidebarIcon({ size = 16 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <path d="M6.2 3v10" />
    </svg>
  );
}

export function TableIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.4" />
      <path d="M2.2 6.4h11.6M6.4 6.4v6.4" />
    </svg>
  );
}

export function DatabaseIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <ellipse cx="8" cy="4.2" rx="4.8" ry="1.9" />
      <path d="M3.2 4.2v7.6c0 1.05 2.15 1.9 4.8 1.9s4.8-.85 4.8-1.9V4.2" />
      <path d="M3.2 8c0 1.05 2.15 1.9 4.8 1.9s4.8-.85 4.8-1.9" />
    </svg>
  );
}

export function ServerIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <rect x="2.2" y="2.8" width="11.6" height="4.4" rx="1.3" />
      <rect x="2.2" y="8.8" width="11.6" height="4.4" rx="1.3" />
      <path d="M4.6 5h.01M4.6 11h.01" />
    </svg>
  );
}

export function DocumentIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M4 2.4h4.6L12 5.8v7.8H4z" />
      <path d="M8.4 2.6v3.2H11.8" />
    </svg>
  );
}

export function FolderIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M2.4 4.6c0-.66.54-1.2 1.2-1.2h2.3l1.3 1.5h4.9c.66 0 1.2.54 1.2 1.2v5.5c0 .66-.54 1.2-1.2 1.2H3.6c-.66 0-1.2-.54-1.2-1.2z" />
    </svg>
  );
}

export function BracesIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M6.2 2.6c-1.5 0-1.5 2.2-1.5 3.4S4.2 8 3.2 8c1 0 1.5.8 1.5 2s0 3.4 1.5 3.4" />
      <path d="M9.8 2.6c1.5 0 1.5 2.2 1.5 3.4s.5 2 1.5 2c-1 0-1.5.8-1.5 2s0 3.4-1.5 3.4" />
    </svg>
  );
}

export function DownloadIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M8 2.6v7.2" />
      <path d="M5.2 7.2 8 10l2.8-2.8" />
      <path d="M3 12.4h10" />
    </svg>
  );
}

export function PencilIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M11.1 2.9a1.4 1.4 0 0 1 2 2l-7 7-2.7.7.7-2.7z" />
    </svg>
  );
}

export function TrashIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M2.8 4.6h10.4" />
      <path d="M6.4 4.6V3.2h3.2v1.4" />
      <path d="M4.4 4.6l.6 8.2h6l.6-8.2" />
      <path d="M6.8 7v3.4M9.2 7v3.4" />
    </svg>
  );
}

export function DuplicateIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <rect x="5.6" y="5.6" width="7.8" height="7.8" rx="1.4" />
      <path d="M10.4 5.6V4a1.4 1.4 0 0 0-1.4-1.4H4a1.4 1.4 0 0 0-1.4 1.4v5a1.4 1.4 0 0 0 1.4 1.4h1.6" />
    </svg>
  );
}

export function MoveIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M2.4 5.2c0-.66.54-1.2 1.2-1.2h2l1.2 1.4h5.6c.66 0 1.2.54 1.2 1.2v4.6c0 .66-.54 1.2-1.2 1.2H3.6c-.66 0-1.2-.54-1.2-1.2z" />
      <path d="M6.6 9h4M9 7.4 10.6 9 9 10.6" />
    </svg>
  );
}

export function DeselectIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" />
      <path d="M5.9 5.9l4.2 4.2" />
    </svg>
  );
}

export function ConnectIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M8 2.4v4.2" />
      <path d="M4.6 4.9a4.6 4.6 0 1 0 6.8 0" />
    </svg>
  );
}

export function DisconnectIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M8 2.4v4.2" />
      <path d="M4.6 4.9a4.6 4.6 0 1 0 6.8 0" />
      <path d="M2.6 2.6l10.8 10.8" />
    </svg>
  );
}

export function SortIcon({ size = 15 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M3.2 4.4h9.6M4.8 8h6.4M6.6 11.6h2.8" />
    </svg>
  );
}

export function SettingsIcon({ size = 16 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M2.5 4.75h11M2.5 11.25h11" />
      <circle cx="6" cy="4.75" r="1.75" />
      <circle cx="10.5" cy="11.25" r="1.75" />
    </svg>
  );
}

export function HelpIcon({ size = 16 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M6.35 6.3a1.7 1.7 0 1 1 2.2 1.85c-.4.16-.62.5-.62.92v.28" />
      <path d="M8 11.9h.01" />
    </svg>
  );
}
