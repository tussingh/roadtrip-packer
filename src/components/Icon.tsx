import type { SVGProps } from 'react';

const PATHS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5',
  pack: 'M5 7h14l-1 13H6L5 7Zm4 0V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M9 12l2 2 4-4',
  map: 'M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4L15 6.5 9 4Zm0 0v13.5m6-11v13.5',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4V8Zm0 0 8 4m0 0 8-4m-8 4v8',
  more: 'M4 7h16M4 12h16M4 17h16',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm5-2 4 4',
  filter: 'M4 6h16M7 12h10M10 18h4',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  right: 'M9 5l7 7-7 7',
  left: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5 10 17l9-10',
  car: 'M5 16v2.5M19 16v2.5M3.5 16h17v-4l-2-5h-11l-2 5v4Zm0-4h17M7 13.5h1M16 13.5h1',
  child: 'M12 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 21v-6l-2-3 3-3h6l3 3-2 3v6M10 21v-4h4v4',
  user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18.5 14.5A6.5 6.5 0 0 1 21.5 20',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14',
  upload: 'M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 20h14',
  trash: 'M5 7h14M10 7V4.5h4V7m-7.5 0 1 13h9l1-13M10 11v6m4-6v6',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9.5v.5',
  warn: 'M12 4 2.5 20h19L12 4Zm0 6v4.5m0 2.5v.5',
  offline: 'M3 4l18 16M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.5-2.6M19 13a10 10 0 0 0-3-2.1M2 9.5a14 14 0 0 1 4-2.4M22 9.5A14 14 0 0 0 11 5.6M12 20h.01',
  calendar: 'M4 6.5h16V20H4V6.5Zm0 4h16M8 4v4M16 4v4',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  refresh: 'M20 5v5h-5M4 19v-5h5M18.5 10A7 7 0 0 0 6 7.5L4 10m16 4-2 2.5A7 7 0 0 1 5.5 14',
  shield: 'M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6l-7-3Zm-3 9 2 2 4-4',
  history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4l3 2',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z',
  layers: 'M12 4 3 9l9 5 9-5-9-5Zm-9 9 9 5 9-5',
  locate: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-4a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-13v3m0 14v3M2 12h3m14 0h3',
  bag: 'M6 8h12v12H6V8Zm3 0V6a3 3 0 0 1 6 0v2M6 12h12',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
