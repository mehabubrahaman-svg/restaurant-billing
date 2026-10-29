import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createQueryClient, Providers } from '../../app/providers';
import { i18n } from '../../i18n';
import { makeDraft } from '../../test/billing-fixtures';
import { BillBreakdown } from './bill-breakdown';

beforeEach(async () => {
  await i18n.changeLanguage('en-IN');
});

describe('Bill breakdown', () => {
  it('names a member’s tier discount by its rate and tier', () => {
    render(
      <Providers client={createQueryClient()}>
        <BillBreakdown
          bill={makeDraft({
            discounts: [
              { kind: 'LOYALTY', value: 1000, amount: 120_00, couponCode: null, reason: 'Gold' },
            ],
          })}
        />
      </Providers>,
    );
    // The tier's name is the discount's reason.
    expect(screen.getByText('(Gold)')).toBeInTheDocument();
    expect(screen.getByText('(Gold)').parentElement).toHaveTextContent('Member discount 10%(Gold)');
    expect(screen.getByText('−120.00')).toBeInTheDocument();
  });
});
