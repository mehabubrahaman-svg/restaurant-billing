# 13 — Design system: type, font and text size

**Status:** v1, 2026-11-08. The scale, the font and the text-size setting are in
place; the UI kit, the guest QR menu, the staff shell and the sign-in screens
use the tokens. The other screens move over as they are touched (§6).

**Applies to:** the web app (every portal, including the guest QR menu), the
iOS app and the Android app. All three carry one scale with the same token
names and sizes.

**Owned files:**

- Web: [`packages/ui/src/typography.ts`](../packages/ui/src/typography.ts): the
  `TYPO` tokens and the `typo()` helper, exported from `@restroos/ui`.
  [`packages/ui/src/styles.css`](../packages/ui/src/styles.css): the font stack
  and the text-size attribute. [`apps/web/src/fonts.ts`](../apps/web/src/fonts.ts):
  the bundled font files.
- iOS: [`apps/ios/RestroOS/Sources/AppTypography.swift`](../apps/ios/RestroOS/Sources/AppTypography.swift),
  with Inter in `Resources/Fonts`.
- Android: [`apps/android/app/src/main/res/values/typography.xml`](../apps/android/app/src/main/res/values/typography.xml),
  with Inter in `res/font/inter_regular.ttf`, `inter_semibold.ttf` and `inter_bold.ttf`.

---

## 1. Why this exists

Before v1 every component chose its own `text-sm font-medium` or
`text-lg font-semibold`. A static count of the web app (2026-11-08) found 326
`text-sm`, 88 `text-xs`, 79 `text-lg` and 30 `text-xl` across 137 files, with
`font-medium` and `font-semibold` mixed on the same kind of text. Two problems
follow:

1. **Screens drift apart.** One card's title is `text-base font-semibold`, the
   next is `text-sm font-medium`, a third is `text-lg font-bold`. They are all
   "a card title" and should read the same.
2. **Nothing can change globally.** Making row titles a step larger means a
   search through 137 files with no way to be sure every one was found.

The tokens fix both at the right layer: a short, semantic vocabulary. When a
row title should change, one line changes and every row follows.

## 2. The scale

Names follow the Material 3 text theme (`titleMedium`, `bodySmall`,
`labelLarge`, …), the vocabulary the owner's other product uses, so the same
mental model works in TypeScript, Swift and Android XML.

| Token           | Web (Tailwind classes)                                            | iOS (pt / weight) | Android (sp / file) | Use for                                              |
| --------------- | ----------------------------------------------------------------- | ----------------- | ------------------- | ---------------------------------------------------- |
| `displayLarge`  | `text-3xl font-bold tracking-tight leading-tight`                 | 30 bold           | 30 / 700            | Hero numbers and headlines (token board, sign-in)    |
| `displayMedium` | `text-2xl font-bold tracking-tight leading-tight`                 | 24 bold           | 24 / 700            | Page titles                                          |
| `titleLarge`    | `text-xl font-bold leading-snug`                                  | 20 bold           | 20 / 700            | Section headings (a menu section, a report block)    |
| `titleMedium`   | `text-lg font-semibold leading-snug`                              | 18 semibold       | 18 / 600            | Dialog and card titles, the brand in the top bar     |
| `titleSmall`    | `text-base font-semibold leading-snug`                            | 16 semibold       | 16 / 600            | Row titles: a dish, a table, a customer              |
| `bodyLarge`     | `text-base leading-relaxed`                                       | 16 regular        | 16 / 400            | Readable body and what a guest reads; input text     |
| `bodyMedium`    | `text-sm leading-normal`                                          | 14 regular        | 14 / 400            | Secondary body: descriptions, table cells, hints     |
| `bodySmall`     | `text-xs leading-normal`                                          | 12 regular        | 12 / 400            | Meta: timestamps, counts, "customisable"             |
| `labelLarge`    | `text-base font-semibold leading-tight`                           | 16 semibold       | 16 / 600            | Touch buttons, prices, switch labels                 |
| `labelMedium`   | `text-sm font-semibold leading-tight`                             | 14 semibold       | 14 / 600            | Small buttons, chips, field labels, status pills     |
| `labelSmall`    | `text-xs font-semibold leading-snug`                              | 12 semibold       | 12 / 600            | Badges, table headers                                |
| `overline`      | `text-[11px] font-bold uppercase tracking-wider leading-tight`    | —                 | —                   | Tiny ALL-CAPS tags above something else              |
| `caption`       | `text-[11px] leading-normal`                                      | 11 regular        | 11 / 400            | The smallest readable note                           |
| `mono`          | `font-mono text-sm tabular-nums leading-normal`                   | —                 | —                   | Codes, ids, references                               |

The sizes sit a step above a dense desktop dashboard's on purpose: staff read
tablets at arm's length and touch 48 px targets (docs/06 §1), and guests read
the menu on their phones. Body text is therefore 16 px and buttons are 16 px
semibold, where a clinical dashboard would use 14 and 12.

### Golden rules

1. **Pick a token by what the text is, not by the size you want.** A card
   title is `titleSmall`; a badge is `labelSmall`; a paragraph is `bodyLarge`.
   If the thought is "I want 12 px", the lens is wrong: ask what role the text
   plays.
2. **Tokens carry size, weight, letter-spacing and line-height only.** Colour,
   background, alignment, truncation and layout stay in the caller's classes:
   `cn(TYPO.bodyMedium, 'text-muted-foreground truncate')`.
3. **No hand-rolled `text-<size> font-<weight>` in new or changed code.** If a
   design really needs a new size, add a token (§7). A one-off hero may compose
   the closest token with an override.
4. **The scale is the same in all three apps.** A token added to the web is
   added to `AppTypography.swift` and `typography.xml` in the same commit.
5. **Pictures of size are not text styling.** The text-size switcher draws an
   "A" at three sizes; those `text-sm`/`text-base`/`text-lg` classes are the
   picture, and are the one place a raw size is fine.

## 3. The face

**Inter**, the same as the owner's other product, with **Noto Sans Devanagari**
and **Noto Sans Bengali** for Hindi and Bengali, which Inter does not cover.
The browser picks the family per character, so "KOT 34 · तैयार" reads as one
line; Hindi and Bengali pages get a little more line height for their tall
marks (`:lang(hi), :lang(bn)` in `styles.css`).

- **Web:** `@fontsource-variable/inter` (one variable file per script range,
  so every weight comes from one 48 kB download) plus the Noto Indic families,
  all bundled by Vite. Nothing is fetched from the internet: the Hub runs on
  the restaurant's LAN, often offline. `@fontsource/noto-sans` stays a
  dependency for the printed slips, which Chromium draws with Noto.
- **iOS:** `Resources/Fonts/InterVariable.ttf`, registered by `UIAppFonts` in
  `Info.plist`. `AppTypography` uses it when it loads and the system font
  otherwise, at the same size and weight.
- **Android:** `res/font/inter_regular.ttf`, `inter_semibold.ttf` and
  `inter_bold.ttf`, the three weights the scale uses, as static files: the
  attribute that sets a variable font's weight needs API 28, and the app
  supports 26. The app theme's `android:fontFamily` is the regular, and each
  text appearance names its weight's file, so there is no synthetic bold.
- Inter is published under the SIL Open Font License; the licence text sits
  next to each copy (`LICENSE-Inter.txt`).

## 4. Text size per device

Staff pick **Default**, **Large** or **Extra large** from the user menu (next
to the theme). It is a per-device preference, like the theme:

- stored in `localStorage` under `restroos.text-size`
  (`STORAGE_KEYS.textSize`), read by `index.html` before the first paint and
  by the theme store;
- applied as `data-text-size` on `<html>`; `styles.css` sets the root font
  size to 112.5 % (large) or 125 % (extra large). Everything is in rem, so
  controls and touch targets grow with the text.

Guests never see the switcher; their phone's own text-size setting applies to
the QR menu because the page uses rem throughout.

## 5. Usage

### Web (React)

```tsx
import { cn, TYPO, typo } from '@restroos/ui';

<h2 className={TYPO.titleLarge}>{category}</h2>
<p className={cn(TYPO.bodyMedium, 'line-clamp-2 text-muted-foreground')}>{lead}</p>
<span className={typo('labelLarge', 'tabular-nums', late && 'text-destructive')}>{price}</span>
```

The UI kit's components already carry their tokens: `Button` (`labelLarge`,
`labelMedium` for `size="sm"`, `titleMedium` for `lg` and `kds`), `Badge`
(`labelSmall`), `Dialog` and `CardTitle` (`titleMedium`), `Field`'s label
(`labelMedium`), `Input`, `Select` and `Textarea` (`bodyLarge`), `Table`
(`bodyMedium`, headers `labelSmall`), `StateChip`, `StatusPill`, `Stepper`,
`Switch`, `Checkbox`, `Alert`, `SegmentedControl`.

### iOS (SwiftUI)

```swift
Text("connect.title").font(AppTypography.displayMedium)
Text(problem).font(AppTypography.bodyMedium).foregroundStyle(.red)
Button("hub.retry") { … }.font(AppTypography.labelLarge)
```

### Android (XML)

```xml
<TextView android:textAppearance="@style/TextAppearance.RestroOS.TitleSmall" … />
<Button android:textAppearance="@style/TextAppearance.RestroOS.LabelLarge" … />
```

## 6. Where it is applied, and the sweep

Done in v1: the UI kit (every component), the guest QR menu (menu, dish view,
order, rating), `features/ratings/stars.tsx`, the staff shell (top bar, user
menu, status page, the boot screen) and the sign-in screens (branch picker,
PIN login, PIN pad). The iOS connect and "can't reach" screens; the Android
connect and "can't reach" panels.

Left as they are, because their classes already match the scale's sizes and
the visual result is the same: the feature screens under `apps/web/src/features/`
and the portals other than `qr-menu`. Move a screen over when you touch it,
one directory per commit, in this order:

1. High-traffic rows and cards: the captain floor and order pad, the KDS
   cards, the POS counter and bill, the admin menu list.
2. Page headers and tab strips in the admin, reports, accounts and inventory
   portals.
3. Dialogs and forms (every `Field`, every dialog body).
4. Everything else, by directory.

`nav-links.tsx` keeps its own responsive pair (`text-xs` in the rail,
`lg:text-base` in the sidebar): a token covers one size, and the rail's labels
are a layout choice, not a text role.

### Migration recipe (one component)

1. Find every `text-<size>` / `font-<weight>` pair.
2. Name the role of each: row title → `titleSmall`; badge → `labelSmall`;
   timestamp → `bodySmall`; paragraph → `bodyLarge`; dense cell → `bodyMedium`;
   button or price → `labelLarge`; field label or chip → `labelMedium`; section
   heading → `titleLarge`; dialog or card title → `titleMedium`; page title →
   `displayMedium`.
3. Replace the pair with the token, keeping colour, layout, truncation and
   responsive classes as they were.
4. Check with `pnpm typecheck` and the directory's tests, then look at the
   screen: the steps between title, body and meta should read as one rhythm.

## 7. Adding a token

Only when no token covers the role. Ask first whether the closest token will
do (a 1 px difference is not a new role), and whether the scale would pass
about fifteen tokens (after that it is a size list again). If it clears both,
add it to `typography.ts`, `AppTypography.swift` and `typography.xml` in one
commit, and add its row to §2.

## 8. The guest menu's layout

The QR menu follows the phone's width and orientation, so turning the phone
re-lays the page:

- The page is fluid up to 72 rem, with a 1 rem gutter (1.5 rem from 640 px).
- Dishes sit in a grid (`DISH_GRID` in `menu-parts.tsx`): one column on a phone
  held upright, two from 640 px (a phone turned sideways, a tablet), three
  from 1280 px. Each card draws its own rule underneath so the columns line
  up.
- A card measures itself (`@container`): the photo is 96 px in a narrow
  column and 128 px when the card has 22 rem or more.
- A dish in the order shows **− n +** and **Remove** right under it, with what
  it comes to. One more of a dish with sizes or add-ons is one more of the way
  it was last chosen; fewer comes off the most recent lines first.
- The dish view is a bottom sheet on a phone held upright; from 640 px it is a
  centred dialog with the photo beside the details, so both stay in view when
  the screen is short.

## 9. FAQ

**Why not Tailwind theme sizes (`text-title-medium`)?** They would tie the
scale to Tailwind and do nothing for the two native apps. A token is a plain
string any renderer can use, and a tokens file can later feed Figma or a
design-tokens export for all three.

**Why do the sizes differ from the owner's other product?** Same names, same
approach, different medium: that product is a dense clinical dashboard on
desktops; this one is tablets touched at arm's length and guests' phones. The
scale is tuned to the medium (§2), which is the point of having one place to
tune it.

**Dark mode and high contrast?** Tokens carry size and weight only. Colour is
the theme's job (`styles.css`: light, dark, high-contrast), and the two
compose: `cn(TYPO.bodyMedium, 'text-muted-foreground')`.

**The printed slips?** Printing (`packages/infrastructure/src/printing/`) has
its own sizes for 58 and 80 mm paper and draws with Noto; it does not use the
screen tokens.
