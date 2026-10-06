type BrandLogoProps = { className?: string; variant?: 'wordmark' | 'mark' };

/** Original ReStock artwork from the supplied brand kit; the two variants preserve its approved colours. */
export function BrandLogo({ className = '', variant = 'wordmark' }: BrandLogoProps) {
  const name = variant === 'mark' ? 'restock-mark' : 'restock-logo-horizontal';
  return <span className={`brand-logo brand-logo-${variant} ${className}`} role="img" aria-label="ReStock by Ledger">
    <img className="brand-logo-on-light" src={`/brand/${name}-colour.svg`} alt="" aria-hidden="true" />
    <img className="brand-logo-on-dark" src={`/brand/${name}-reversed.svg`} alt="" aria-hidden="true" />
  </span>;
}
