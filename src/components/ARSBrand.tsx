import React from 'react';

type ARSBrandProps = {
  compact?: boolean;
  dark?: boolean;
  subtitle?: string;
  className?: string;
};

/**
 * Text-based ARS brand mark used until the business supplies its official logo.
 * Do not confuse the business mark with the software vendor credit (RS Nextward).
 */
export default function ARSBrand({
  compact = false,
  dark = false,
  subtitle = 'HARDWARE & TRADING',
  className = '',
}: ARSBrandProps) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`} aria-label="ARS Hardware">
      <div className="relative flex h-12 w-[62px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-amber-300/40 bg-gradient-to-br from-amber-300 via-amber-400 to-orange-500 shadow-[0_6px_20px_rgba(245,158,11,0.18)]">
        <span aria-hidden="true" className="absolute -right-2 -top-3 h-8 w-8 rotate-45 border-2 border-white/25" />
        <span className="relative font-heading text-xl font-black italic tracking-[-0.12em] text-[#10213b] pr-1.5">ARS</span>
        <span aria-hidden="true" className="absolute bottom-1 left-3 right-3 h-[2px] rounded bg-[#10213b]/70" />
      </div>
      {!compact && (
        <div className="min-w-0">
          <p className={`font-heading text-lg leading-tight font-extrabold tracking-tight ${dark ? 'text-[#12253f]' : 'text-white'}`}>ARS <span className="font-semibold">Hardware</span></p>
          <p className={`mt-1 text-[9px] font-bold uppercase tracking-[0.15em] ${dark ? 'text-amber-700' : 'text-amber-300'}`}>{subtitle}</p>
        </div>
      )}
    </div>
  );
}
