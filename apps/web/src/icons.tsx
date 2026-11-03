export type IconName =
  | 'grid'
  | 'calendar'
  | 'people'
  | 'ledger'
  | 'arrow'
  | 'plus'
  | 'download'
  | 'search'
  | 'chevron'
  | 'check'
  | 'wallet'
  | 'leaf'
  | 'close'
  | 'menu'
  | 'reset'
  | 'shield'
  | 'back';
const paths: Record<IconName, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  calendar: 'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4 M8 14h2 M14 14h2 M8 17h2',
  people:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  ledger: 'M5 3h14v18H5z M9 7h6 M9 11h6 M9 15h2 M14 15h1',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  plus: 'M12 5v14 M5 12h14',
  download: 'M12 3v12 M7 10l5 5 5-5 M5 16v5h14v-5',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  chevron: 'M9 5l7 7-7 7',
  check: 'M5 12l4 4L19 6',
  wallet: 'M3 6h17v15H3z M3 6V3h14v3 M15 11h6v5h-6z',
  leaf: 'M20 3C8 2 2 8 5 16c7 7 16-1 15-13Z M5 21 16 8',
  close: 'M6 6l12 12 M6 18 18 6',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  reset: 'M3 11a9 9 0 1 1 3 8 M3 4v7h7',
  shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',
  back: 'M19 12H5 M10 7l-5 5 5 5',
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
