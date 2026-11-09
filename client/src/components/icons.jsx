// Inline line icons (UI stage 1): 24-unit grid, 1.5 px stroke, currentColor, decorative only —
// every control that shows one also has a text label or aria-label.
const PATHS = {
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  network: <><circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /><path d="M11 6.8L6 17.2M13 6.8l5 10.4M7 19h10" /></>,
  diagram: <path d="M12 3v4M8 7h8v4H8zM12 11v4M6 15h12M6 15v4M12 15v4M18 15v4" />,
  map: <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />,
  report: <path d="M6 3h9l3 3v15H6zM15 3v3h3M9 11h6M9 15h6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  chart: <path d="M4 20h16M4 20V4M7 15l4-4 3 3 5-6" />,
  shield: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  dice: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01" strokeWidth="2.5" /></>,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  battery: <><rect x="3" y="7" width="16" height="10" rx="2" /><path d="M21 11v2M7 10v4M11 10v4" /></>,
  split: <path d="M12 3v6M12 9l-6 6v6M12 9l6 6v6" />,
  balance: <path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6h6zM19 8l-3 6h6z" />,
  cable: <path d="M3 17c3 0 4-10 9-10s6 10 9 10" />,
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z" />,
  meter: <path d="M4 16a8 8 0 1 1 16 0M12 16l4-5M4 20h16" />,
  clipboard: <path d="M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4" />,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>,
  wand: <path d="M4 20L15 9M14 4v2M19 9h2M17.5 5.5L19 4M13 10l1 1" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  'chevrons-left': <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />,
  'chevrons-right': <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />
};

export default function Icon({ name, size = 20 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name] || null}
    </svg>
  );
}
