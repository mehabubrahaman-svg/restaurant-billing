/**
 * Words printed on bills and KOTs. English always; a branch can add Hindi or
 * Bengali (receipt languages), printed as an image. Pending review by native
 * speakers, like the UI catalogues.
 */
export const LABELS = {
  taxInvoice: { en: 'TAX INVOICE', hi: 'कर बीजक', bn: 'কর চালান' },
  creditNote: { en: 'CREDIT NOTE', hi: 'क्रेडिट नोट', bn: 'ক্রেডিট নোট' },
  duplicate: { en: 'DUPLICATE', hi: 'प्रतिलिपि', bn: 'প্রতিলিপি' },
  cancelled: { en: 'CANCELLED', hi: 'रद्द', bn: 'বাতিল' },
  billNo: { en: 'Bill No', hi: 'बिल सं.', bn: 'বিল নং' },
  against: { en: 'Against', hi: 'मूल बिल', bn: 'মূল বিল' },
  date: { en: 'Date', hi: 'दिनांक', bn: 'তারিখ' },
  table: { en: 'Table', hi: 'टेबल', bn: 'টেবিল' },
  token: { en: 'Token', hi: 'टोकन', bn: 'টোকেন' },
  order: { en: 'Order', hi: 'ऑर्डर', bn: 'অর্ডার' },
  cashier: { en: 'Cashier', hi: 'कैशियर', bn: 'ক্যাশিয়ার' },
  item: { en: 'Item', hi: 'वस्तु', bn: 'পদ' },
  amount: { en: 'Amount', hi: 'राशि', bn: 'পরিমাণ' },
  subtotal: { en: 'Subtotal', hi: 'उप-योग', bn: 'উপমোট' },
  discount: { en: 'Discount', hi: 'छूट', bn: 'ছাড়' },
  roundOff: { en: 'Round off', hi: 'राउंड ऑफ', bn: 'রাউন্ড অফ' },
  total: { en: 'TOTAL', hi: 'कुल', bn: 'মোট' },
  paid: { en: 'Paid', hi: 'भुगतान', bn: 'পরিশোধ' },
  change: { en: 'Change', hi: 'वापसी', bn: 'ফেরত' },
  refunded: { en: 'Refunded', hi: 'वापस किया', bn: 'ফেরত দেওয়া' },
  thanks: { en: 'Thank you! Visit again.', hi: 'धन्यवाद! फिर आइए।', bn: 'ধন্যবাদ! আবার আসবেন।' },
  kot: { en: 'KOT', hi: 'KOT', bn: 'KOT' },
  dineIn: { en: 'Dine-in', hi: 'डाइन-इन', bn: 'ডাইন-ইন' },
  takeaway: { en: 'Takeaway', hi: 'टेकअवे', bn: 'টেকঅ্যাওয়ে' },
  delivery: { en: 'Delivery', hi: 'डिलीवरी', bn: 'ডেলিভারি' },
  captain: { en: 'Captain', hi: 'कैप्टन', bn: 'ক্যাপ্টেন' },
  note: { en: 'NOTE', hi: 'नोट', bn: 'নোট' },
} as const;

export type ReceiptLanguage = 'en' | 'hi' | 'bn';
export type LabelKey = keyof typeof LABELS;

/** "TOTAL / মোট" in the receipt's languages. */
export function label(key: LabelKey, languages: readonly ReceiptLanguage[]): string {
  return [...new Set(languages.map((l) => LABELS[key][l]))].join(' / ');
}

/** "1,23,456.78": Indian digit grouping, no currency sign, from integer paise. */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = String(Math.trunc(abs / 100));
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${sign}${grouped}.${String(abs % 100).padStart(2, '0')}`;
}

/** Basis points as a percentage: 250 → "2.5", 500 → "5". */
export function formatRate(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = bp % 100;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
}
