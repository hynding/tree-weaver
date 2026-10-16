import { h } from '@stencil/core';
import type { DisplayId } from '@tree-weaver/core';

const paths: Record<string, string> = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  upload: 'M12 15V3m0 0L7 8m5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  download: 'M12 3v12m0 0-5-5m5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  link: 'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  refresh: 'M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4',
  x: 'M6 6l12 12M18 6 6 18',
  wrap: 'M4 4h16v16H4zM8 8h8v8H8z',
  parent: 'M12 19V5m0 0-6 6m6-6 6 6',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  tree: 'M12 3v18M12 9 7 6m5 3 5-3M12 15l-6-3m6 3 6-3M8 21h8',
};

export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

export function DisplayIcon({ display }: { display: DisplayId }) {
  const common = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
  switch (display) {
    case 'xl':
      return (
        <svg viewBox="0 0 24 24" {...common} aria-hidden="true">
          <rect x="1.5" y="3" width="21" height="14" rx="1.5" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case 'lg':
      return (
        <svg viewBox="0 0 24 24" {...common} aria-hidden="true">
          <rect x="3" y="4" width="18" height="12" rx="1.5" />
          <path d="M1 20h22" />
        </svg>
      );
    case 'tablet':
      return (
        <svg viewBox="0 0 24 24" {...common} aria-hidden="true">
          <rect x="4.5" y="2" width="15" height="20" rx="2" />
          <path d="M11 18h2" />
        </svg>
      );
    case 'mobile-landscape':
      return (
        <svg viewBox="0 0 24 24" {...common} aria-hidden="true">
          <rect x="2" y="7" width="20" height="10" rx="2" />
          <path d="M18 11v2" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" {...common} aria-hidden="true">
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <path d="M11 18h2" />
        </svg>
      );
  }
}

export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#2f6f4f" />
      <path d="M16 5v22M16 12l-6-4M16 12l6-4M16 19l-7-4M16 19l7-4M10 27h12" stroke="#c9f2d8" stroke-width="2.4" stroke-linecap="round" fill="none" />
    </svg>
  );
}
