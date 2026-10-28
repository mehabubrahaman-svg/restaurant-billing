# 11 — Staff Training Guide

One page per role, to teach at the pilot in about 20 minutes each, on the
restaurant's own devices. Every screen works in English, हिन्दी and বাংলা:
tap the language buttons at the top. Hindi and Bengali wording still awaits
review by native speakers at the pilot; note anything that reads oddly.

**For everyone**

- Sign in with your **PIN** on a paired device (captain tablets, kitchen
  screens, the counter). Passwords are for the owner's laptop and new devices.
- A **manager PIN** box appears when something needs approval: a big
  discount, cancelling food the kitchen already has, a refund, or a
  reprint. The manager types their PIN on your device; you don't hand over
  the device or share PINs.
- **Live** (green) at the top means you're connected to the Hub. **Offline**
  means the Wi-Fi dropped: keep working, your changes are queued and sent
  in order when it's back. Don't close the browser tab while it says
  *queued*.

---

## Captain (tablet)

1. **Floor**: tables are coloured by state: free, occupied, bill printed,
   reserved. Tap a free table, enter the number of guests.
2. **Order pad**: tap dishes to add them; tap again for more. Long-press or
   tap ⋯ for **options**: variant (Half/Full), add-ons, a note for the
   kitchen ("less spicy") and quick notes.
3. **Send to kitchen** prints the KOT at each station and puts it on the
   kitchen screen. Add more later and send again: only the new items go.
4. A dish turns **ready** (✓) when the kitchen bumps it; you get an alert.
   Mark it **served** when it's on the table.
5. **Cancel an item** before sending: just remove it. After sending, you
   need a reason and a manager PIN; the kitchen gets a cancellation slip.
6. **Move / merge**: from the table's menu, move the order to another table
   or merge two tables' orders.

Practice: open T1 for 2, add 2 × Chicken Biryani (Full) with raita and 4
naan, note "less spicy", send; then add a lassi and send again.

---

## Kitchen (KDS screen)

1. Each card is a KOT: number, table or token, how old it is, the captain.
   Notes are in **CAPITALS** with a flag. Struck-through lines were cancelled.
2. Card colours: normal, then amber as it nears its target time, red and
   pulsing when late.
3. Tap the big button to move the KOT on: **Accept → Start → Ready**. Or
   tap a single dish to mark just that one ready (bump); the last one makes
   the whole KOT ready.
4. Use the station filter if one screen serves one station (Tandoor, Bar).
5. The head chef can **assign** a KOT to a cook.

Practice: accept the KOT from the captain's practice order, bump the naan,
then mark the biryani ready.

---

## Cashier (billing counter)

1. **Open a cash shift** at the start with the cash float in the drawer.
   The counter asks if you forget.
2. **Counter**: pick the order on the left (search by table, token or order
   number). The bill preview shows every line, taxes, service charge and
   round-off. A bar with liquor gets **two bills**: food (GST) and liquor
   (VAT).
3. **Bill options**: discount (with a reason; above the limit needs a
   manager), coupon code, complimentary, remove the service charge if the
   guest objects, and the customer's mobile number for the visit history.
4. **Generate the bill** (F9). It prints; reprints say DUPLICATE.
5. **Payment pad**: cash (enter what the guest handed over; the change is
   shown), card or UPI: charge on the standalone terminal first, then type
   the approval code / RRN and the last 4 digits. Split across methods as
   needed. The order and table clear when fully paid.
6. **Delivery**: Swiggy/Zomato orders are keyed in on the Delivery screen
   with their order id. They're billed without GST (the platform pays it).
7. **Refund**: from Bills, open the invoice → Refund, choose the items (or
   an amount) and how the money goes back. A credit note prints. Needs a
   manager.
8. **Cancel a bill** (wrong table billed): Bills → invoice → Cancel, with
   a reason and a manager. The order reopens for a fresh bill.
9. **Close the shift**: count the drawer by note and coin, then the card/UPI
   totals from each terminal's settlement slip. The difference shows before
   you confirm; then the **Z report** prints.

Shortcuts: F2 find order · F4 discount · F6 card · F7 UPI · F8 cash · F9
bill / record payment · Esc close.

---

## Manager

- Approve with your PIN on the staff member's device; every approval is in
  the audit log with both names.
- **Day-end**: Reports → Day-end. Check sales, taxes per rate, payment
  modes against the terminals' settlements, cancellations and voids, and
  each cashier's variance. Print it and download the CSV.
- **86 a dish**: Kitchen availability, so captains can't order it.
- Watch the **dashboard** for late KOTs and open tables.

---

## Owner

- **Dashboard**: today, this month and this financial year, the last two
  weeks, payment mix, best sellers.
- **Accountant**: Reports → Sales register CSV for any date range, with
  CGST, SGST and VAT per invoice and credit notes as negative rows.
- **Backups** run every hour by themselves. Keep the USB drive plugged in.
  Keep the **backup passphrase** card safe: without it a backup can't be
  restored on a new PC.
- **Staff**: add people, give them a role, reset a forgotten PIN. Remove
  access the day someone leaves.
- **Settings**: discount limit, service charge, receipt languages, printers,
  delivery channels and coupons.
