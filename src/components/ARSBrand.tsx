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
 * Official ARS artwork in both featured and compact layouts.
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
    <div className={`flex min-w-0 items-center ${featured ? 'gap-5' : 'gap-3'} ${className}`} aria-label="ARS Distributors">
      <img src={arsPrintLogoUrl} alt="ARS official logo" width={92} height={74}
        className={`shrink-0 object-contain ${featured ? 'h-[66px] w-[82px] sm:h-[74px] sm:w-[92px]' : 'h-10 w-[50px]'} ${dark ? '' : 'invert'}`} />
      {!compact && (
        <div className="min-w-0">
          <p className={`font-heading leading-tight font-extrabold tracking-tight ${featured ? 'text-3xl sm:text-4xl' : 'text-lg'} ${dark ? 'text-[#12253f]' : 'text-white'}`}>ARS <span className="font-semibold">Distributors</span></p>
          <p className={`mt-1 font-bold uppercase tracking-[0.12em] ${featured ? 'text-xs' : 'text-[9px]'} ${dark ? 'text-amber-700' : 'text-amber-300'}`}>{subtitle}</p>
        </div>
      )}
    </div>
  );
}
