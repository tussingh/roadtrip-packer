# Backup, restore and data safety

Everything Milestone knows lives in this browser’s IndexedDB on your phone. There is no server copy.

## Export

*Settings and backup → Export backup* saves `milestone-backup-YYYY-MM-DD.json`. It contains:

- trips and their checklists (ticks, quantity edits, notes, custom items)
- family profiles, inventory, trip reviews, learning statistics, always-pack items
- saved places and saved routes, settings and family-wide assumptions

Not included: downloaded map data (too large; re-download or re-import the region files). The file lists which regions you had.

The dashboard reminds you when you have never backed up or the last backup is over 30 days old. Keep backups off the phone (email to yourself, cloud drive, computer). The file contains your child’s name and birth date — store it accordingly.

## Restore

*Settings and backup → Restore from file*, then choose:

- **Merge** — adds missing records; when a record exists in both, the newer `updatedAt` wins.
- **Replace everything** — clears trips, checklists, profiles, inventory, history, saved places/routes, then restores the file. Downloaded map regions stay.

Before anything is written the file is checked:

- valid JSON and a Milestone backup format marker
- data version not newer than the app (otherwise: “update the app, then import again”)
- record shapes (ids, coordinates in range, learning factors sane)
- every checklist item belongs to a trip in the file
- no duplicate records

If any check fails, nothing changes and the reasons are shown. Restores run in a single transaction.

## Older backups and app upgrades

The database has a schema version (currently 4). Upgrades run additive migrations when the app opens: new stores are created and existing records are filled with safe defaults, never deleted. Backups from older versions go through the same normalisers, so a v1 backup restores into a v3 app (tested in `tests/integration/persistence.test.ts`).

## Delete all data

*Settings and backup → Delete all data on this device* (type DELETE to confirm) removes the whole database — trips, checklists, profiles, inventory, history, settings and map regions — and reloads the app with a fresh starter family. It cannot be undone without a backup. The cached app files remain until you uninstall the app or clear site data in the browser.

## Family sync is also an off-phone copy

With family sync on, the private repository holds an encrypted copy of everything, with full history. If a phone is lost, install the app on a new phone, set up sync with the same passphrase and choose “Use the shared family data”. Keep exporting backups too — they do not depend on the passphrase.

## Reducing the risk of data loss

1. Install to the Home Screen (iOS clears data of uninstalled web apps that are not used for a while).
2. Tap *Ask the browser to keep data* in Settings.
3. Export after big changes and before trips.
