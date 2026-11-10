/**
 * NimPoint mark: a location pin (a cash point near you) with the Naira double bar inside.
 * Original artwork, deliberately not the Nimiq hexagon.
 */
export function LogoMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="18" fill="#12130f" />
      <path d="M32 11c-9.4 0-17 7.4-17 16.6C15 40 32 54 32 54s17-14 17-26.4C49 18.4 41.4 11 32 11Z" fill="#e9b213" />
      <circle cx="32" cy="27.5" r="9" fill="#12130f" />
      <path d="M25.5 25.2h13M25.5 29.8h13" stroke="#e9b213" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
