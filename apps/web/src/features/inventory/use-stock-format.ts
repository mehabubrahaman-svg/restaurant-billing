import type { BaseUnit, Unit } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../../i18n/use-format';
import { tDynamic } from '../../lib/dynamic-t';
import { costUnitOf, percentText, quantityParts, quantityText, unitPrice } from './quantity';

/** Stock quantities and prices in the user's language and digits: "28.35 kg", "₹86.67/kg". */
export function useStockFormat() {
  const { t } = useTranslation();
  const format = useFormat();
  return useMemo(() => {
    /** kg → "kg" / "किलो" / "কেজি"; a unit this build doesn't know shows its code. */
    const unitLabel = (code: string) => tDynamic(t, `inventory.units.${code}`, code);
    const amount = (value: string, unit: string, signed: boolean) =>
      t('inventory.quantity', {
        value: format.decimal(value, signed ? { signDisplay: 'exceptZero' } : {}),
        unit: unitLabel(unit),
      });
    const qty = (milli: number, base: BaseUnit, signed = false) => {
      const parts = quantityParts(milli, base);
      return amount(parts.value, parts.unit, signed);
    };
    const money = (paise: number) => format.money(Money.ofPaise(paise));
    return {
      unitLabel,
      /** 28.35 kg, 950 g, 12 pc; `signed` puts a + on gains (variances, movements). */
      qty,
      /** In one unit when it fits exactly (1.5 dozen), else the way `qty` shows it. */
      qtyIn: (milli: number, unit: Unit, base: BaseUnit, signed = false) => {
        const text = quantityText(milli, unit.toBaseMilli);
        return text === null ? qty(milli, base, signed) : amount(text, unit.code, signed);
      },
      money,
      /** A cost in paise per 1000 base units, per kg, litre or piece: "₹86.67/kg". */
      perUnit: (costPerThousandBase: number, base: BaseUnit) => {
        const { unit, toBaseMilli } = costUnitOf(base);
        return t('inventory.perUnit', {
          price: money(unitPrice(costPerThousandBase, toBaseMilli)),
          unit: unitLabel(unit),
        });
      },
      /** A price per one of `unit`: "₹100.00/kg". */
      priceIn: (paise: number, unit: Unit) =>
        t('inventory.perUnit', { price: money(paise), unit: unitLabel(unit.code) }),
      /** Basis points as a percentage: 2350 → "23.5%"; `signed` gives "+6.67%". */
      percent: (bp: number, signed = false) =>
        t('inventory.percent', {
          value: format.decimal(percentText(bp), signed ? { signDisplay: 'exceptZero' } : {}),
        }),
    };
  }, [t, format]);
}
