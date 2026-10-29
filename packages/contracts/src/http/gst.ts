import { z } from 'zod';
import { PaiseSchema } from './common';

const Money = PaiseSchema;
const Int = z.number().int();
/** IGST, CGST, SGST and cess on a taxable value. */
const Heads = { igst: Money, cgst: Money, sgst: Money, cess: Money };
const Taxed = z.object({ taxable: Money, ...Heads });

/** Who filed: the branch's registration and the return period (business dates). */
const ReturnHeader = {
  from: z.string(),
  to: z.string(),
  branchName: z.string(),
  gstin: z.string().nullable(),
  /** "19" */
  stateCode: z.string(),
  stateName: z.string(),
  generatedAt: z.string(),
  /** Names of the states used as places of supply: {"19": "West Bengal"}. */
  stateNames: z.record(z.string(), z.string()),
};

const HsnRowSchema = z.object({
  hsn: z.string(),
  description: z.string(),
  /** NOS for goods, NA for services (SAC 99…). */
  uqc: z.string(),
  quantity: Int,
  rateBp: Int,
  /** Taxable value + tax. */
  totalValue: Money,
  ...Taxed.shape,
});

/**
 * GSTR-1 for a period, laid out like the GST offline tool's sections. Credit
 * notes to unregistered guests are netted into B2CS; amounts in paise; a
 * place of supply is a state code.
 */
export const Gstr1Schema = z.object({
  ...ReturnHeader,
  /** 4A: invoices to registered buyers, one row per invoice and rate. */
  b2b: z.array(
    z.object({
      gstin: z.string(),
      receiverName: z.string().nullable(),
      invoiceNo: z.string(),
      invoiceDate: z.string(),
      invoiceValue: Money,
      placeOfSupply: z.string(),
      rateBp: Int,
      ...Taxed.shape,
    }),
  ),
  /** 5: inter-state invoices to unregistered buyers above ₹1,00,000. */
  b2cl: z.array(
    z.object({
      invoiceNo: z.string(),
      invoiceDate: z.string(),
      invoiceValue: Money,
      placeOfSupply: z.string(),
      rateBp: Int,
      ...Taxed.shape,
    }),
  ),
  /** 7: everything else to unregistered buyers, by place of supply and rate. */
  b2cs: z.array(z.object({ placeOfSupply: z.string(), rateBp: Int, ...Taxed.shape })),
  /** 9B: credit notes to registered buyers. */
  cdnr: z.array(
    z.object({
      gstin: z.string(),
      receiverName: z.string().nullable(),
      noteNo: z.string(),
      noteDate: z.string(),
      noteValue: Money,
      originalInvoiceNo: z.string().nullable(),
      placeOfSupply: z.string(),
      rateBp: Int,
      ...Taxed.shape,
    }),
  ),
  /** 9B: credit notes on B2CL invoices. */
  cdnur: z.array(
    z.object({
      noteNo: z.string(),
      noteDate: z.string(),
      noteValue: Money,
      originalInvoiceNo: z.string().nullable(),
      placeOfSupply: z.string(),
      rateBp: Int,
      ...Taxed.shape,
    }),
  ),
  /** 8: nil-rated, exempt and non-GST supplies (liquor is non-GST). */
  exempt: z.array(
    z.object({
      kind: z.enum([
        'INTER_REGISTERED',
        'INTRA_REGISTERED',
        'INTER_UNREGISTERED',
        'INTRA_UNREGISTERED',
      ]),
      nilRated: Money,
      exempted: Money,
      nonGst: Money,
    }),
  ),
  /** 12: HSN/SAC summary, split into B2B and B2C. */
  hsn: z.object({ b2b: z.array(HsnRowSchema), b2c: z.array(HsnRowSchema) }),
  /** 13: documents issued, per series. */
  docs: z.array(
    z.object({
      nature: z.enum(['INVOICE', 'CREDIT_NOTE']),
      series: z.string(),
      fromNo: z.string(),
      toNo: z.string(),
      total: Int,
      cancelled: Int,
    }),
  ),
  /** 14(b): supplies through e-commerce operators who pay the GST (section 9(5)). */
  eco: z.array(
    z.object({ operator: z.string(), operatorGstin: z.string().nullable(), taxable: Money }),
  ),
});
export type Gstr1 = z.infer<typeof Gstr1Schema>;

/** GSTR-3B for a period: the summary return. Amounts in paise. */
export const Gstr3bSchema = z.object({
  ...ReturnHeader,
  /** 3.1 */
  outward: z.object({
    /** (a) taxable, other than zero-rated, nil-rated and exempt. */
    taxable: Taxed,
    /** (b) zero-rated (exports): not made by a restaurant. */
    zeroRated: Taxed,
    /** (c) nil-rated and exempt. */
    nilExempt: Money,
    /** (d) inward supplies on reverse charge: not tracked. */
    reverseCharge: Taxed,
    /** (e) non-GST (liquor). */
    nonGst: Money,
  }),
  /** 3.1.1 (ii): made through e-commerce operators who pay the tax (section 9(5)). */
  ecoSupplies: Money,
  /** 3.2: inter-state supplies to unregistered persons, by place of supply. */
  interStateUnregistered: z.array(
    z.object({ placeOfSupply: z.string(), taxable: Money, igst: Money }),
  ),
  /** 4: input tax credit from posted goods received (the books' input tax accounts). */
  itc: z.object({
    available: z.object(Heads),
    /**
     * Restaurant service at 5% comes without input tax credit; with no other
     * rate charged, the credit is shown but not used.
     */
    allowed: z.boolean(),
  }),
  /** 5: purchases from unregistered vendors (no GST charged), by inter/intra-state. */
  inwardNonGst: z.object({ interState: Money, intraState: Money }),
  /** 6.1: output tax less the usable credit, head by head (no cross-utilisation). */
  payable: z.object(Heads),
  creditCarriedForward: z.object(Heads),
});
export type Gstr3b = z.infer<typeof Gstr3bSchema>;

/** The state VAT sales register for liquor: bill by bill, and by rate. Amounts in paise. */
export const VatRegisterSchema = z.object({
  from: z.string(),
  to: z.string(),
  branchName: z.string(),
  vatTin: z.string().nullable(),
  generatedAt: z.string(),
  /** Credit notes are negative. */
  rows: z.array(
    z.object({
      date: z.string(),
      invoiceNo: z.string(),
      kind: z.enum(['INVOICE', 'CREDIT_NOTE']),
      customerName: z.string().nullable(),
      rateBp: Int,
      taxable: Money,
      vat: Money,
      surcharge: Money,
      total: Money,
    }),
  ),
  byRate: z.array(
    z.object({
      rateBp: Int,
      bills: Int,
      taxable: Money,
      vat: Money,
      surcharge: Money,
      total: Money,
    }),
  ),
  totals: z.object({ taxable: Money, vat: Money, surcharge: Money, total: Money }),
});
export type VatRegister = z.infer<typeof VatRegisterSchema>;
