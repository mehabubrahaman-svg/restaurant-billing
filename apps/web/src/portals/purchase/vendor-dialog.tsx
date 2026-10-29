import type { Vendor } from '@restroos/contracts';
import { Alert, Button, Dialog, Field, Input, Textarea } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { useSession } from '../../features/auth/auth-store';
import {
  invalidatePurchasing,
  PURCHASING_KEYS,
  usePurchaseErrorMessage,
} from '../../features/purchasing/purchasing-queries';
import { gstinCheckCharacter } from '../../features/setup/gstin';
import { toast } from '../../features/toast/toast-store';
import { toLatinDigits } from '../../lib/units';

const CODE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
const PHONE = /^\+?[0-9][0-9 -]{5,19}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GSTIN = /^[0-9]{2}[A-Z0-9]{13}$/;

type Errors = Partial<
  Record<'code' | 'name' | 'contact' | 'phone' | 'email' | 'address' | 'gstin' | 'terms', string>
>;

/** How GST from this vendor is claimed, read from the GSTIN's state code. */
export function useInputTaxHint(): (gstin: string) => string {
  const { t } = useTranslation();
  const stateCode = useSession()?.branch.stateCode ?? '';
  return (gstin: string) => {
    const clean = gstin.trim().toUpperCase();
    if (clean === '') return t('purchase.vendors.taxHint.none');
    if (!GSTIN.test(clean)) return t('purchase.vendors.gstinHint');
    return clean.slice(0, 2) === stateCode
      ? t('purchase.vendors.taxHint.local')
      : t('purchase.vendors.taxHint.interstate');
  };
}

/** Add a vendor, or edit one (code, name, contact, GSTIN, payment terms). */
export function VendorDialog({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: Vendor | null;
  onClose: () => void;
  onSaved?: (vendor: Vendor) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = usePurchaseErrorMessage();
  const taxHint = useInputTaxHint();
  const [code, setCode] = useState(vendor?.code ?? '');
  const [name, setName] = useState(vendor?.name ?? '');
  const [contact, setContact] = useState(vendor?.contactPerson ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [email, setEmail] = useState(vendor?.email ?? '');
  const [address, setAddress] = useState(vendor?.address ?? '');
  const [gstin, setGstin] = useState(vendor?.taxId ?? '');
  const [terms, setTerms] = useState(vendor === null ? '' : String(vendor.paymentTermsDays));
  const [errors, setErrors] = useState<Errors>({});

  const save = useMutation({
    mutationFn: async () => {
      const found: Errors = {};
      const cleanCode = code.trim().toUpperCase();
      const cleanPhone = toLatinDigits(phone).trim();
      const cleanGstin = gstin.trim().toUpperCase();
      const days = terms.trim() === '' ? 0 : Number(toLatinDigits(terms.trim()));
      if (!CODE.test(cleanCode)) found.code = t('purchase.vendors.codeError');
      if (name.trim() === '' || name.trim().length > 120) found.name = t('validation.nameLength');
      if (contact.trim().length > 120) found.contact = t('validation.nameLength');
      if (cleanPhone !== '' && !PHONE.test(cleanPhone)) found.phone = t('validation.phone');
      if (email.trim() !== '' && !EMAIL.test(email.trim())) found.email = t('validation.email');
      if (address.trim().length > 300) found.address = t('purchase.vendors.addressError');
      if (cleanGstin !== '' && !GSTIN.test(cleanGstin))
        found.gstin = t('purchase.vendors.gstinError');
      if (!Number.isInteger(days) || days < 0 || days > 365)
        found.terms = t('purchase.vendors.termsError');
      setErrors(found);
      if (Object.keys(found).length > 0) return null;
      const body = {
        code: cleanCode,
        name: name.trim(),
        contactPerson: contact.trim() === '' ? null : contact.trim(),
        phone: cleanPhone === '' ? null : cleanPhone,
        email: email.trim() === '' ? null : email.trim(),
        address: address.trim() === '' ? null : address.trim(),
        taxId: cleanGstin === '' ? null : cleanGstin,
        paymentTermsDays: days,
      };
      return vendor === null
        ? api.purchasing.createVendor(body)
        : api.purchasing.updateVendor(vendor.id, { ...body, version: vendor.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      queryClient.setQueryData(PURCHASING_KEYS.vendor(saved.id), saved);
      void invalidatePurchasing(queryClient);
      toast(t('purchase.vendors.saved', { name: saved.name }));
      onSaved?.(saved);
      onClose();
    },
    onError: (error) => {
      if (isApiError(error, 'VENDOR_CODE_TAKEN'))
        setErrors((e) => ({ ...e, code: t('purchase.errors.vendorCodeTaken') }));
    },
  });

  const cleanGstin = gstin.trim().toUpperCase();
  // A typo in a GSTIN usually breaks its check character; the Hub only checks the shape.
  const checkWarning =
    GSTIN.test(cleanGstin) && gstinCheckCharacter(cleanGstin.slice(0, 14)) !== cleanGstin[14]
      ? t('purchase.vendors.gstinCheck')
      : null;

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={
        vendor === null
          ? t('purchase.vendors.add')
          : t('purchase.vendors.editNamed', { name: vendor.name })
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="vendor-form" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="vendor-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {save.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Field
            label={t('purchase.vendors.code')}
            hint={t('purchase.vendors.codeHint')}
            required
            error={errors.code}
          >
            {(p) => (
              <Input
                {...p}
                className="font-mono uppercase"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={20}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('purchase.vendors.name')} required error={errors.name}>
            {(p) => (
              <Input
                {...p}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('purchase.vendors.contact')} error={errors.contact}>
            {(p) => (
              <Input
                {...p}
                maxLength={120}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('purchase.vendors.phone')} error={errors.phone}>
            {(p) => (
              <Input
                {...p}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={20}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('purchase.vendors.email')} error={errors.email}>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('purchase.vendors.terms')}
            hint={t('purchase.vendors.termsHint')}
            error={errors.terms}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="off"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field
          label={t('purchase.vendors.gstin')}
          hint={[taxHint(gstin), checkWarning].filter((s) => s !== null).join(' ')}
          error={errors.gstin}
        >
          {(p) => (
            <Input
              {...p}
              className="font-mono uppercase"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={15}
              value={gstin}
              onChange={(e) => setGstin(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('purchase.vendors.address')} error={errors.address}>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={300}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
        </Field>
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
