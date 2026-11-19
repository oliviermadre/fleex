export function FactoryIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 20V10l5 3.2V10l5 3.2V6h6v14z" />
      <path d="M3 20h18M16 10h1M16 14h1" />
    </svg>
  );
}
