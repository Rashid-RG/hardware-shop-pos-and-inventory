import React from 'react';
import { arsPrintLogoUrl } from '../utils/arsPrintLogo';

type ARSBrandProps = {
  compact?: boolean;
  featured?: boolean;
  dark?: boolean;
  subtitle?: string;
  className?: string;
};

/**
 * Official ARS logo on featured login screens; compact legacy mark elsewhere.
 * Do not confuse the business mark with the software vendor credit (RS Nextward).
 */
export default function ARSBrand({
  compact = false,
  featured = false,
  dark = false,
  subtitle = 'IMPORTS & WHOLESALE DISTRIBUTION',
  className = '',
}: ARSBrandProps) {
  return (
    <div className={`flex min-w-0 items-center ${featured ? 'gap-5' : 'gap-3'} ${className}`} aria-label="ARS Hardware">
      {featured ? (
        <img src={arsPrintLogoUrl} alt="ARS official logo" width={92} height={74}
          className={`h-[66px] w-[82px] shrink-0 object-contain sm:h-[74px] sm:w-[92px] ${dark ? '' : 'invert'}`} />
      ) : (
      <div className={`relative flex shrink-0 items-center justify-center overflow-hidden border border-amber-300/50 bg-gradient-to-br from-amber-300 via-amber-400 to-orange-500 shadow-[0_6px_20px_rgba(245,158,11,0.18)] h-14 w-[70px] rounded-xl`}>
        <span aria-hidden="true" className="absolute -right-2 -top-3 h-8 w-8 rotate-45 border-2 border-white/25" />
        <span className={`relative font-heading font-black italic tracking-[-0.1em] text-[#10213b] pr-1.5 text-2xl`}>ARS</span>
        <span aria-hidden="true" className="absolute bottom-1 left-3 right-3 h-[2px] rounded bg-[#10213b]/70" />
      </div>
      )}
      {!compact && (
        <div className="min-w-0">
          <p className={`font-heading leading-tight font-extrabold tracking-tight ${featured ? 'text-3xl sm:text-4xl' : 'text-lg'} ${dark ? 'text-[#12253f]' : 'text-white'}`}>ARS <span className="font-semibold">Hardware</span></p>
          <p className={`mt-1 font-bold uppercase tracking-[0.12em] ${featured ? 'text-xs' : 'text-[9px]'} ${dark ? 'text-amber-700' : 'text-amber-300'}`}>{subtitle}</p>
        </div>
      )}
    </div>
  );
}
