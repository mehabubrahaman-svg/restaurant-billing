import { SetupRequestSchema } from '@restroos/contracts';
import { describe, expect, it } from 'vitest';
import { isWeakPin } from '../../lib/pin';
import {
  defaultReceiptLanguages,
  stepForServerPath,
  toSetupRequest,
  validateStep,
} from './setup-form';
import { STATES, VALID } from '../../test/fixtures';

describe('setup validation', () => {
  it('accepts a complete form on every step', () => {
    for (const step of ['business', 'liquor', 'receipt', 'admin', 'backup', 'review'] as const) {
      expect(validateStep(step, VALID, STATES)).toEqual({});
    }
  });

  it('checks the GSTIN against the chosen state', () => {
    expect(validateStep('business', { ...VALID, gstin: '27AAPFU0939F1ZV' }, STATES)).toEqual({
      gstin: 'setup.errors.gstinState',
    });
    expect(validateStep('business', { ...VALID, gstin: 'ABC' }, STATES).gstin).toBe(
      'setup.errors.gstinFormat',
    );
  });

  it('requires matching passwords and PINs, and refuses weak PINs', () => {
    const errors = validateStep(
      'admin',
      { ...VALID, adminPasswordConfirm: 'other', adminPin: '1234', adminPinConfirm: '1234' },
      STATES,
    );
    expect(errors).toEqual({
      adminPasswordConfirm: 'validation.passwordsDiffer',
      adminPin: 'validation.pinWeak',
    });
  });

  it('blocks liquor in a prohibition state unless overridden', () => {
    const bihar = { ...VALID, stateCode: '10' };
    expect(validateStep('liquor', bihar, STATES).liquorEnabled).toBe('setup.errors.prohibition');
    expect(validateStep('liquor', { ...bihar, overrideProhibition: true }, STATES)).toEqual({});
  });

  it('has no default VAT rate: an empty one is an error', () => {
    expect(validateStep('liquor', { ...VALID, vatPercent: '' }, STATES).vatPercent).toBe(
      'validation.percent',
    );
    expect(validateStep('liquor', { ...VALID, vatPercent: '0' }, STATES).vatPercent).toBe(
      'setup.errors.vatRate',
    );
  });

  it('needs 1 or 2 receipt languages and a 12+ character passphrase', () => {
    expect(validateStep('receipt', { ...VALID, receiptLanguages: [] }, STATES)).toHaveProperty(
      'receiptLanguages',
    );
    expect(
      validateStep(
        'backup',
        { ...VALID, backupPassphrase: 'short', backupPassphraseConfirm: 'short' },
        STATES,
      ),
    ).toEqual({
      backupPassphrase: 'setup.errors.passphraseShort',
    });
  });

  it('defaults receipt languages from the state’s local languages', () => {
    expect(defaultReceiptLanguages(STATES[0])).toEqual(['bn', 'en']);
    expect(defaultReceiptLanguages(STATES[2])).toEqual(['en']);
    expect(defaultReceiptLanguages(undefined)).toEqual(['en']);
  });

  it('builds a request the contract accepts, with rates in basis points', () => {
    const request = toSetupRequest(VALID);
    expect(SetupRequestSchema.safeParse(request).success).toBe(true);
    expect(request.branch.code).toBe('KOL1');
    expect(request.admin.username).toBe('owner');
    expect(request.liquor).toMatchObject({ enabled: true, vatRateBp: 2000, surchargeBp: 250 });
    expect(toSetupRequest({ ...VALID, liquorEnabled: false }).liquor).toEqual({ enabled: false });
  });

  it('maps server validation paths back to steps', () => {
    expect(stepForServerPath('branch.gstin')).toBe('business');
    expect(stepForServerPath('/admin/password')).toBe('admin');
    expect(stepForServerPath('liquor.vatRateBp')).toBe('liquor');
    expect(stepForServerPath('setupCode')).toBe('review');
  });
});

describe('isWeakPin', () => {
  it('refuses repeats and straight runs, like the Hub', () => {
    for (const pin of ['1111', '1234', '4321', '345678', '987654'])
      expect(isWeakPin(pin)).toBe(true);
    for (const pin of ['2580', '1357', '9021', '112233']) expect(isWeakPin(pin)).toBe(false);
  });
});
