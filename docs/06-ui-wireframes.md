# 06 — UI Wireframes & Design System

## 1. Design principles

| Principle | Concrete rule |
|---|---|
| Speed over decoration | Any common action takes ≤ 3 taps. Billing a table takes ≤ 5 seconds for a trained cashier. |
| Touch first | Minimum hit target **48 × 48 px** (56 px on KDS). No hover-only affordances. Swipe actions also have a button. |
| Glanceable | Colour encodes state, and **every colour is paired with an icon/label** (colour-blind safe, WCAG AA contrast). |
| Calm motion | Framer Motion ≤ 200 ms. Only state changes animate (new KOT slides in, table changes colour). Respects `prefers-reduced-motion`. |
| Themes | Light (front of house), Dark (default for KDS, reduces kitchen glare), High-contrast. Tokens live in `packages/ui/tokens.css`. |
| Responsive | Phone 360 px (owner, QR guest) · Tablet 768–1280 px (captain, KDS) · Desktop 1366 px+ (POS, admin). |
| Offline visible | A persistent status pill shows `● Live` / `◐ Reconnecting` / `ᛒ Bluetooth mode` (Wi-Fi down, orders still flowing) / `○ Offline — 3 actions queued`. |
| Language | Every screen ships in English, हिन्दी and বাংলা. Layouts are tested with the longest translation, and nothing is truncated without a tooltip. Prices use Indian grouping (₹1,00,000). |

### State colours (shared across portals)

| State | Token | Icon |
|---|---|---|
| Available | `--state-available` green-500 | ○ |
| Occupied | `--state-occupied` blue-500 | ● + elapsed time |
| Billing | `--state-billing` violet-500 | ₹ |
| Reserved | `--state-reserved` amber-500 | 🕑 |
| Cleaning | `--state-cleaning` slate-400 | ✦ |
| Delayed (KDS) | `--state-danger` red-500 + pulse | ⚠ |

## 2. Shell & navigation

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◧ RestroOS  [Ground Floor ▾]      🔍 Search (Ctrl+K)   ● Live  🔔3  (RK)▾ │
├────────────┬─────────────────────────────────────────────────────────────┤
│ 🏠 Home     │                                                             │
│ 🍽 Floor    │                                                             │
│ 👨‍🍳 Kitchen  │                 < portal content >                          │
│ 💳 POS      │                                                             │
│ 📦 Stock    │                                                             │
│ 📊 Reports  │                                                             │
│ ⚙ Settings │                                                             │
└────────────┴─────────────────────────────────────────────────────────────┘
 The side nav lists only portals the user's permissions allow. Devices paired
 as KDS / Token display boot straight into that portal, full screen, no nav.
```

## 3. Login (shared device)

```
┌──────────────────────────────┐
│          RestroOS            │
│   Billing Counter 1 (POS)    │
│                              │
│  (RK)  (AS)  (MJ)  (+Other)  │   ← recent users on this device
│                              │
│  PIN for Ravi K.  [EN|हि|বা] │
│        ● ● ○ ○               │
│   [1] [2] [3]                │
│   [4] [5] [6]                │
│   [7] [8] [9]                │
│   [⌫] [0] [→]                │
└──────────────────────────────┘
```

## 4. Captain — floor view (tablet, landscape)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Ground] [Rooftop] [AC Hall]          Filter: (All)(Mine)(Free)  ● Live  │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐   ┌──────────────┐               │
│  │ T1 ○ │  │ T2 ● │  │ T3 ● │  │ T4 🕑│   │ T5 ●  ₹2,340 │               │
│  │ 4p   │  │ 32m  │  │ 1h05⚠│  │ 8:30 │   │ 6p  48m  ₹   │               │
│  └──────┘  └──────┘  └──────┘  └──────┘   └──────────────┘               │
│  ┌──────┐  ┌──────┐       ╭────╮  ╭────╮                                 │
│  │ T6 ✦ │  │ T7 ○ │       │ R1 │  │ R2 │   ← round tables                │
│  └──────┘  └──────┘       ╰────╯  ╰────╯                                 │
│                                                                          │
│ [+ Takeaway]  [+ Delivery]                 Legend ○Free ●Occ 🕑Res ✦Clean│
└──────────────────────────────────────────────────────────────────────────┘
 Tap table → order pad. Long-press → move / merge / mark cleaning.
```

## 5. Captain — order pad

```
┌───────────────────────────────────────────────┬──────────────────────────┐
│ ← T2 · 4 guests · 32 min        🔍 biry___     │ T2 · Order #0142         │
├────────────┬──────────────────────────────────┤──────────────────────────┤
│ ★ Popular  │ ┌────────────┐ ┌────────────┐    │ SENT (KOT 31)            │
│ Starters   │ │🔴 Chicken  │ │🟢 Veg      │    │  Paneer Tikka    x1  ✔   │
│ Biryani  ◀ │ │  Biryani   │ │  Biryani   │    │                          │
│ Curries    │ │  ₹320      │ │  ₹260      │    │ NEW (not sent)           │
│ Breads     │ └────────────┘ └────────────┘    │  Chicken Biryani  − 2 +  │
│ Desserts   │ ┌────────────┐ ┌────────────┐    │   ✎ Less spicy           │
│ Beverages  │ │🔴 Mutton   │ │🟡 Egg      │    │   + Raita (₹40)          │
│            │ │  Biryani   │ │  Biryani   │    │  Butter Naan      − 4 +  │
│            │ │  ₹420      │ │  ₹240 86'd │    │                          │
│            │ └────────────┘ └────────────┘    │ Subtotal        ₹1,280   │
│            │                                  │──────────────────────────│
│            │                                  │ [  Send to Kitchen (2) ] │
└────────────┴──────────────────────────────────┴──────────────────────────┘
 Tap item → add 1 (opens variant/addon sheet if item has options).
 🔴/🟢/🟡 = non-veg/veg/egg marks. "86'd" items are greyed and not tappable.
```

Item options bottom sheet:
```
┌──────────────────────────────────────┐
│ Chicken Biryani                ₹320  │
│ Size:   (•) Full ₹320  ( ) Half ₹190 │
│ Add-ons (max 2): [✓] Raita +₹40      │
│                  [ ] Extra Egg +₹25  │
│ Note: [Less spicy] [No onion] [Jain] │
│       [_____________________________]│
│ Qty  − 2 +        [ Add · ₹720 ]     │
└──────────────────────────────────────┘
```

## 6. Kitchen Display (KDS, dark theme, 1080p landscape)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ KITCHEN · Station: All ▾   Pending 9 · Avg 11m · Delayed 2 ⚠   12:41 ● Live  │
├────────────────┬────────────────┬────────────────┬──────────────────────────┤
│ NEW (3)        │ ACCEPTED (2)   │ COOKING (4)    │ READY (2)                │
├────────────────┼────────────────┼────────────────┼──────────────────────────┤
│┌──────────────┐│┌──────────────┐│┌──────────────┐│┌──────────────┐          │
││KOT 34  T2 2m ││││KOT 31 T5  6m ││││KOT 28 T3 18m⚠││││KOT 27 TK#12  │          │
││Dine-in  Ravi ││││Chef: — [Asgn]││││Chef A        ││││Ready 1m      │          │
││2 Chkn Biryani││││1 Paneer Tikka││││1 Dal Makhani ││││1 Veg Burger  │          │
││  ⚑ LESS SPICY││││              ││││3 Butter Naan ││││              │          │
││  + Raita     ││││              ││││              ││││              │          │
││4 Butter Naan ││││              ││││              ││││              │          │
││ [  ACCEPT  ] ││││ [ START ]    ││││ [ READY ✔ ]  ││││ [ SERVED ]   │          │
│└──────────────┘│└──────────────┘│└──────────────┘│└──────────────┘          │
└────────────────┴────────────────┴────────────────┴──────────────────────────┘
 Card colour shifts: < target = neutral, > 80% target = amber, > target = red + pulse.
 Special notes are ALWAYS upper-case with a flag icon. Tap an item line to bump it.
```

## 7. POS billing counter (desktop)

```
┌───────────────────────────────┬──────────────────────────────────────────┐
│ Open tabs     [Dine][TA][Del] │ T5 · Order #0139 · Cust: 98xxxx1234 Asha │
│ ┌───────────────────────────┐ │──────────────────────────────────────────│
│ │ T5   ₹2,340  48m  BILL ▶  │ │ Chicken Biryani  2 × 320          640.00 │
│ │ T2   ₹1,280  32m          │ │   + Raita        2 ×  40           80.00 │
│ │ TK#12 ₹180   paid  ✔      │ │ Butter Naan      4 ×  60          240.00 │
│ │ T3   ₹3,910  1h05         │ │ ...                                      │
│ └───────────────────────────┘ │──────────────────────────────────────────│
│                               │ Subtotal                        2,200.00 │
│ [+ New Takeaway]              │ Discount (10% · approved MJ)     −220.00 │
│                               │ Service charge 5%                  99.00 │
│ Shift: Ravi · Float ₹2,000    │ CGST 2.5%  49.50   SGST 2.5%  49.50      │
│                               │ Round off                           +0.00 │
│                               │ TOTAL                        ₹ 2,078.00   │
│                               │──────────────────────────────────────────│
│                               │ [Discount][Coupon][Customer][Split][Comp]│
│                               │ [ Cash ] [ Card ] [ UPI ] [ Credit ]     │
│                               │ [        Print & Settle  (F9)          ] │
└───────────────────────────────┴──────────────────────────────────────────┘
 Keyboard: F2 search, F4 discount, F8 cash, F9 settle, Esc back.
```

Card / UPI on the standalone terminal:
```
┌────────────────────────────────────────┐
│ Card payment             ₹ 2,078.00    │
│ 1. Charge ₹2,078.00 on the terminal    │
│ 2. Enter the slip details:             │
│    Terminal  [ HDFC-1 ▾ ]              │
│    Approval  [ 4F7K21 ]  Last 4 [4821] │
│ [ Cancel ]           [ Record payment ]│
└────────────────────────────────────────┘
 UPI: same dialog with "UPI ref / RRN". The amount defaults to the remaining
 balance. The shift-close screen asks for each terminal's settlement total.
```

Mixed food + liquor order (state requires a separate liquor bill):
```
┌───────────────────────────────────────────────┐
│ T5 will be billed as 2 invoices               │
│  INV/2026-27/000412  Food      ₹1,890  (GST)  │
│  LIQ/2026-27/000087  Beverages ₹1,240  (VAT)  │
│ [ Pay together ₹3,130 ]   [ Pay separately ]  │
└───────────────────────────────────────────────┘
```

Split payment dialog:
```
┌───────────────────────────────────────┐
│ Total ₹2,078.00      Remaining ₹578.00│
│ Cash   [ 1,000.00 ]  ✕                │
│ UPI    [   500.00 ]  ✕  RRN [______]  │
│ [+ Card] [+ UPI] [+ Cash]             │
│ [ Cancel ]            [ Confirm ]     │
└───────────────────────────────────────┘
```

## 8. Admin dashboard (owner)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Today ▾   Branch: Indiranagar ▾                              ● Live      │
├────────────┬────────────┬────────────┬────────────┬──────────────────────┤
│ Sales today│ Orders     │ Avg ticket │ Margin     │ Vendor due           │
│ ₹1,84,220  │ 312        │ ₹590       │ 64.2%      │ ₹42,800 (3 overdue)  │
│ ▲ 8% vs LW │ ▲ 4%       │ ▲ 3%       │ ▼ 1.1 pt   │                      │
├────────────┴────────────┴────────────┴────────────┴──────────────────────┤
│ Hourly sales (today vs last week)       │ Payment mix                    │
│  ▁▂▅▇█▆▃▂▅▇█▆▂  (line chart)              │  ◔ Cash 31% UPI 52% Card 17%   │
├─────────────────────────────────────────┼────────────────────────────────┤
│ Kitchen: avg cook 11m · delayed 6 · fastest chef: Chef B (8m)            │
│ Inventory: 4 low stock · 2 expiring in 3 days         [View alerts →]    │
│ Staff: 14/16 clocked in                                                  │
└──────────────────────────────────────────────────────────────────────────┘
 Month / Year tabs switch the same widgets to monthly sales, yearly revenue.
```

## 9. Token display (TV) and QR menu (phone)

```
TOKEN DISPLAY                         QR MENU (guest phone)
┌──────────────────────────────┐      ┌──────────────────┐
│  PREPARING      │  READY ✔   │      │ Spice Route · T7 │
│  41 42 44 45    │  38  39    │      │ 🔍 Search        │
│  46 47          │  40  43    │      │ [Starters][Biry] │
│                 │            │      │ Chicken Biryani  │
│                 │  (43 pulses│      │ ₹320    [ Add ]  │
│                 │   + chime) │      │ ...              │
└──────────────────────────────┘      │ [View cart (3)]  │
                                      └──────────────────┘
```
