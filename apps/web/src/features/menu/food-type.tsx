import { FoodMark } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import type { FoodType } from '../../api/endpoints';

export const FOOD_TYPES: readonly FoodType[] = ['VEG', 'NON_VEG', 'EGG', 'VEGAN', 'NA'];

/** The Indian veg / non-veg / egg mark with its translated name; nothing for "not marked". */
export function FoodTypeMark({
  type,
  size = 'md',
  className,
}: {
  type: FoodType;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const { t } = useTranslation();
  if (type === 'NA') return null;
  return (
    <FoodMark
      type={type}
      label={t(`menu.foodTypes.${type}`)}
      size={size}
      {...(className === undefined ? {} : { className })}
    />
  );
}
