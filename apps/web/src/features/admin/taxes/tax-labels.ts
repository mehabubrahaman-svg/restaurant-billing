import type { TFunction } from 'i18next';
import type { TaxComponentBody } from '../../../api/endpoints';
import { bpToPercent } from '../../../lib/units';

/** "CGST 2.5% · SGST 2.5% (within state)", one entry per component. */
export function componentLabel(t: TFunction, c: TaxComponentBody, digits: (n: string) => string) {
  const rate = digits(bpToPercent(c.rateBp));
  const scope =
    c.appliesTo === 'INTRA_STATE'
      ? t('taxes.withinState')
      : c.appliesTo === 'INTER_STATE'
        ? t('taxes.interState')
        : null;
  const code = c.code === 'SURCHARGE' ? t('taxes.surcharge') : c.code;
  return scope === null
    ? t('taxes.componentRate', { code, rate })
    : t('taxes.componentRateScoped', { code, rate, scope });
}
