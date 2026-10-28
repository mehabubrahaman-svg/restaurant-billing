# 10 — Pilot Runbook

How to install RestroOS at the pilot restaurant, run the first service, and
recover when something goes wrong. Written for the person doing the install
(field engineer) and the restaurant's manager. Phase 1 goal (docs/08): **a
full service day with zero data loss**.

## 1. Before the visit

| Item | Check |
| --- | --- |
| Hub PC | Windows 10/11 or Ubuntu 22.04+, 8 GB RAM, SSD, wired Ethernet to the router. Not a till that gets switched off at night. |
| Router | One Wi-Fi network for all devices. Note its admin login. Reserve a fixed IP for the Hub PC (DHCP reservation) so tablets bookmarked to it keep working. |
| UPS | The Hub PC and the router on a UPS (≥ 15 min). A power cut must not take down the Hub mid-bill. |
| Printers | Bill printer and each kitchen printer: Ethernet/Wi-Fi ESC/POS (port 9100) preferred; USB on the Hub PC works. Fixed IPs for network printers. 58 or 80 mm paper. |
| Tablets | Android 10+ with Chrome, charged, on the restaurant Wi-Fi. One per captain, one per kitchen station. A TV with a browser (or a stick) for the token display, if they do takeaway. |
| Second backup target | A USB drive left plugged into the Hub, or a NAS share. |
| Data from the owner | Menu with prices, GST rates, HSN/SAC codes, variants and add-ons, kitchen station of each dish (a spreadsheet for the CSV import); table list per area; staff names and roles; GSTIN, VAT TIN and excise licence if they serve liquor; state; card/UPI terminal names (e.g. HDFC-1, Paytm-1). |
| Installer | `RestroOS-Hub-Setup-x.y.z.exe` (Windows) or `.AppImage`/`.deb` (Linux) from the Desktop installers workflow, on a USB stick. |

## 2. Install the Hub (about 30 minutes)

1. Install the app on the Hub PC. It starts in the tray and opens the
   RestroOS window. On Linux, install `libsecret-1-0` first (the deb pulls
   it in) so the database key is sealed by the keyring.
2. The window shows the **setup code**. Run the setup wizard: organisation,
   branch, **state** (wave 1: North, East, North-East), liquor settings,
   languages, the owner's admin account and PIN.
3. **Backup passphrase**: the owner chooses it and writes it on the
   provided card, which goes in the restaurant's safe. Without it no
   backup can be restored on another PC. RestroOS cannot recover it.
4. Tray → **Start at login** stays ticked. In Windows power settings, turn off
   sleep for the Hub PC.
5. Settings → Backups: choose the USB drive or NAS share as the second copy
   folder (desktop app: *Choose folder*; headless Linux:
   `RESTRO_BACKUP_COPY_DIR`). Press **Back up now** and check both folders
   have a `.rbak` file.
6. Note the Hub's addresses from the tray (*Copy address*). The HTTPS one is
   what tablets use.

## 3. Set up the restaurant (1–2 hours, with the manager)

1. **Menu**: Admin → Menu → Import CSV. Dry-run first, fix row errors,
   then import. Check every dish's kitchen station and food type mark.
   Add Hindi/Bengali names where the kitchen wants them.
2. **Taxes and charges**: confirm the GST groups the wizard made (5% for
   restaurant service is typical), the liquor VAT group, and the service
   charge rule (optional on the bill).
3. **Floor**: draw the areas and tables; print the table QR sheet.
4. **Staff**: create each user with the right role (Owner, Manager,
   Cashier, Captain, Kitchen). Each sets a 4-digit PIN on first sign-in.
   Managers' PINs approve discounts over the limit, cancellations after the
   kitchen has an item, refunds and reprints.
5. **Printers**: Admin → Printers. Add the bill printer (purpose BILL) and
   one KOT printer per kitchen station. Press **Test** on each. Hindi or
   Bengali receipts print as images; check one prints legibly.
6. **Devices**: on each tablet, open the Hub address, then pair it from
   Admin → Devices (QR code + the fingerprint check). Pair the token TV as
   a Token display. Add the home-screen shortcut.
7. **Delivery channels**: Admin → Sales channels: Swiggy, Zomato with their
   commission %, menu price markup and *GST paid by the operator* ticked.
8. **Coupons** and the **discount limit** (Settings → Branch) as the owner
   wants.

## 4. Dry run (30 minutes, before the first real service)

Run these with the staff, on the real devices:

- [ ] Captain opens a table, adds items with a note, sends to the kitchen.
      The KOT prints at the right station and appears on the KDS.
- [ ] Kitchen bumps the items; the captain's tablet shows them ready.
- [ ] Cashier opens a cash shift, bills the table, takes a split card + cash
      payment with change. The bill prints; the table turns free.
- [ ] A discount above the limit asks for a manager PIN.
- [ ] A cancelled item after the KOT asks for a manager PIN and prints a
      cancellation KOT.
- [ ] A takeaway with a token shows on the token TV when ready.
- [ ] A Swiggy order keyed in at the counter; its bill has no GST.
- [ ] Refund one item: a credit note prints.
- [ ] Pull the Hub's network cable for a minute while a captain adds items:
      the tablet shows "offline, queued" and sends them when it's back.
- [ ] X report mid-shift; then close the shift with a count → Z report.
- [ ] Reports → Day-end shows these sales; download the CSV.

Then cancel the test bills (or restore the backup taken before the dry run)
so the real day starts clean. Invoice numbers are gapless: cancelled test
bills stay in the series, which the accountant should be told about.

## 5. During the first service

- The field engineer stays on site for the first lunch and dinner.
- Watch the Hub's tray icon: "Hub is running". The KDS screens show a
  "Live" badge; "Reconnecting" for more than a few seconds means Wi-Fi
  trouble near that device.
- Keep paper KOT pads at the pass as a fallback for the first week.

## 6. End of day

1. Each cashier closes their cash shift with the count (Z report prints).
2. Manager opens Reports → Day-end, checks totals against the card/UPI
   terminal settlements, prints it, and downloads the CSV for the accountant.
3. Leave the Hub PC **on**. Backups run every hour when something changed;
   the latest is in the backups folder and on the USB drive.

## 7. When something goes wrong

| Symptom | What to do |
| --- | --- |
| A tablet says "Cannot reach the Hub" | Check it is on the restaurant Wi-Fi (not mobile data). Open the Hub address in Chrome. If other devices work, forget and rejoin the Wi-Fi. Its queued orders are kept and sent when it reconnects. |
| No device can reach the Hub | Is the Hub PC on and the tray icon there? Did its IP change (DHCP reservation missing)? Restart the app from the tray (Quit, then start it). |
| A printer doesn't print | Admin → Printers → Test. Paper, power, cable; for network printers, ping its IP from the Hub. Bills can be shown on screen and printed from the browser meanwhile; KOTs show on the KDS. |
| Hindi/Bengali receipts print in English | The raster renderer isn't available (headless Hub without Chromium). Use the desktop app, or set receipt languages to English. |
| "The Hub server stopped 5 times in 2 minutes" | Note the time, send the log (tray → Open logs folder → `hub.log`) to support. Data is safe. Usually: disk full, or the database folder was moved. |
| Hub PC died / disk failed | §8. |
| Owner forgot the backup passphrase | Backups can't be decrypted. The Hub keeps working; set a new passphrase is a planned feature, so call support before taking any further step. |

## 8. Restore onto another PC (target: under 10 minutes)

1. Install RestroOS Hub on the replacement PC. **Don't** run the setup
   wizard on real data: use a throwaway organisation name and any
   passphrase. It's replaced in step 4.
2. Settings → Backups → **Import**: pick the newest `.rbak` from the USB
   drive or NAS, and enter the **restaurant's backup passphrase**.
3. Press **Restore** on the imported backup, type `RESTORE` to confirm, and
   enter the passphrase again if asked.
4. The Hub restarts (a few seconds) with the restaurant's data. Sign in
   with the owner's account.
5. Give the new PC the old one's fixed IP (router DHCP reservation), so
   tablets reconnect without re-pairing. If the IP changes, re-pair each
   tablet (Admin → Devices).
6. Check the last bill in Bills matches the last printed receipt. Anything
   billed after the backup was taken has to be re-entered from the paper
   receipts. With hourly backups that is at most the last hour.

A restore on the same Hub (to undo a mistake) is the same from step 3. It
always takes a **pre-restore** backup first, so it can itself be undone.

## 9. Escalation

Field engineer → RestroOS support (phone in the welcome pack) with: the Hub
version (tray → About / window title), the time it happened, the device,
and `hub.log`. Never send the backup passphrase or a `.rbak` file over
WhatsApp.
