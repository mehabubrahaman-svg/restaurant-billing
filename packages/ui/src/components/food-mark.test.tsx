import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FoodMark, type FoodMarkType } from './food-mark';

describe('FoodMark', () => {
  it('is an image named by its label', () => {
    render(<FoodMark type="VEG" label="Veg" />);
    expect(screen.getByRole('img', { name: 'Veg' })).toHaveAttribute('data-food', 'VEG');
  });

  it('draws a different shape for every type, so colour is never the only cue', () => {
    const shapes = (['VEG', 'NON_VEG', 'EGG', 'VEGAN'] as FoodMarkType[]).map((type) => {
      const { container, unmount } = render(<FoodMark type={type} label={type} />);
      const inner = container.querySelector('svg > :not(title):not(rect)');
      const shape = `${inner?.tagName}:${inner?.getAttribute('d') ?? ''}`;
      unmount();
      return shape;
    });
    expect(new Set(shapes).size).toBe(4);
  });
});
