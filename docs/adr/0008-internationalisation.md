# ADR 0008 — English, Hindi, Bengali at launch; Indic printing via raster

- Status: Accepted
- Date: 2026-10-28

## Decision
- i18next/react-i18next with ICU messages. Locales `en-IN`, `hi-IN` and `bn-IN` ship in Phase 1. Other Indian languages are translation files plus a bundled Noto font.
- Per-user language, falling back to the branch default. Bilingual receipts via `branches.receipt_locales`.
- Menu translations are stored in `name_translations` JSON.
- Thermal printers cannot render Devanagari or Bengali (they also need glyph shaping), so receipts/KOTs in those scripts are rendered by Chromium to a bitmap and printed as ESC/POS raster. English-only prints stay in text mode.

## Consequences
Raster printing is slower (~0.5–1 s per receipt) and needs printers that support raster graphics (nearly all modern ESC/POS printers). This goes on the certified-printer checklist.
