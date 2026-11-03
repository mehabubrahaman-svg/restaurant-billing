# ADR 0013 — Menu upload from Excel, with dish photos kept in the database

- Status: Accepted
- Date: 2026-11-03

## Context
Restaurants arrive with their menu in a spreadsheet, often several hundred
dishes, and want photos on the QR menu and the POS. The Sprint 3 import took
CSV only, with no photos, sizes or add-ons, and it rewrote every row it was
given. Owners use Excel or Google Sheets, not CSV. Phone photos are 3 to 8 MB
each and carry GPS data. The Hub runs on an ordinary PC with no image tools,
and everything it stores must survive a backup and restore.

## Decision
1. **Excel and CSV.** The web app reads `.xlsx` in the browser: `fflate`
   unzips it and the browser's `DOMParser` reads the sheet XML, with no
   spreadsheet library (the common one is unmaintained on npm and has had
   prototype-pollution advisories). It sends the cells as `rows` to the
   existing `POST /menu/import`, which still also takes `csv`. The template
   and an export of the current menu are written the same way. Every cell
   is text, so SKUs and HSN codes keep their leading zeros, and drop-downs
   list food types, `yes`/`no` and this Hub's tax groups.
2. **More columns, same rules.** The new columns are `variants`
   (`Half:220 | Full:320`, keeping each size's id when its name stays),
   `addon_groups`, `image`, `description_hi`/`description_bn`,
   `prep_time_min` and `active`. Headers match in any case, and a space counts
   as `_`. An empty optional cell keeps what the dish has, and `-` clears it.
   Every row is still checked first, and nothing is written if any row is
   wrong. A row that would change nothing is reported `unchanged` and not
   rewritten, so re-uploading a sheet doesn't bump every item's version or
   flood ordering devices with menu changes.
3. **A preview before anything is saved.** The dry run returns, per row, the
   action (create, update, unchanged) and what happens to its photo, plus
   warnings such as an uploaded photo no row uses. An optional
   `retireMissing` takes active dishes that aren't in the sheet off the menu
   (retired, never deleted), for a full-menu sync.
4. **Photos are prepared in the browser.** A photo is shrunk to 1280 px on
   its long side, with a 320 px square thumbnail, and re-encoded as WebP
   (JPEG where the browser can't write WebP). Re-encoding drops EXIF, so GPS
   never reaches the Hub. A phone photo becomes about 100 to 200 KB. The Hub
   needs no native image library (no `sharp`, which would mean another native
   build on Windows).
5. **The Hub checks and stores the bytes.** `POST /media/images` checks the
   type from the file's first bytes (PNG, JPEG, WebP only, so SVG is out) and
   its size (1.5 MB, 4096 px). It stores both images in `media_assets`
   (migration 0021) under the SHA-256 of the full image, so the same photo is
   stored once and an id can't be guessed. Photos live in the encrypted
   database, so backups, restores and the relay carry them with nothing else
   to copy.
6. **Served publicly, immutably.** `GET /media/{id}` and `/media/{id}/thumb`
   need no sign-in, because QR-menu guests aren't signed in. They are sent
   with `Cache-Control: immutable`, `nosniff` and a sandboxing CSP. Items
   point at a photo with `imageId`. The admin menu, the order pad (captain
   and POS) and the QR menu show the thumbnail.

## Consequences
- 500 dishes with photos add about 60 to 100 MB to the database and to each
  backup. That's acceptable for a Hub PC. A cleanup of photos no dish uses any
  more can come later; until then they stay, which also keeps old exports
  re-importable.
- iPhone HEIC photos can't be decoded by Chrome on Windows or Android, so the
  app asks for JPEG instead.
- Photos are uploaded before the check, so the preview is exact. A photo
  uploaded for an import that is then abandoned stays in the database, unused.
