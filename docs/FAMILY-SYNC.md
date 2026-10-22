# Family sync (two phones, one family)

Both phones run the same app from the same address. Each phone keeps its own complete copy of the data and works offline. When online, the app syncs one **encrypted** file in a **private GitHub repository** you own, so both phones see the same trips, checklists, ticks, inventory, profiles and history.

```
 Your phone ──┐                                  ┌── Wife's phone
 (IndexedDB)  ├─► milestone-family.json (encrypted) ◄─┤ (IndexedDB)
              │    in PRIVATE repo  you/milestone-family-data
```

## Why two repositories

| Repository | Visibility | Contains |
|---|---|---|
| `roadtrip-packer` | Public (free GitHub Pages) | The app code. No personal data. |
| `milestone-family-data` | **Private** | One encrypted file with your family's data. |

The app refuses to sync to a public repository.

## One-time setup

1. **Create the data repository:** GitHub → New repository → name `milestone-family-data` → **Private** → create (leave it empty).
2. **Create a token for each phone:** GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate.
   - Repository access: *Only select repositories* → `milestone-family-data`
   - Permissions → Repository → **Contents: Read and write** (nothing else)
   - Expiration: your choice (up to a year); you will need a new token when it expires.
   Make a second token the same way for your wife's phone. Both tokens are created from your account (fine-grained tokens only reach repositories owned by the account that makes them), and each can be revoked on its own.
3. **Pick a family passphrase** (10+ characters). Write it down somewhere safe. Without it, the shared file cannot be read by anyone — including you.
4. **Your phone:** Settings and backup → Family sync → *Set up family sync* → enter your GitHub username, repository name, token, passphrase and a name for the phone → *Check connection* → *Start family sync*.
5. **Wife's phone:** open the same app address, install it, then the same steps with her token and the **same passphrase** → *Check connection* → **Use the shared family data on this phone**.

## Day to day

- Sync runs automatically when the app opens, when the phone comes back online, and about 15 seconds after changes. The dashboard shows “Family sync: 2 min ago”; tap it to sync now.
- Offline edits are kept and sent next time you are online.
- **Conflicts:** every record (each checklist item, trip, inventory entry, profile) is merged separately. If you both change the *same* item, the most recent change wins. Different items never overwrite each other — you can both pack at the same time.
- **Deletions** (a trip, an item, an inventory entry) reach the other phone.
- **Not synced:** downloaded map regions (each phone downloads its own), theme, backup reminders, and the token/passphrase themselves.

## Privacy and security

- Data is encrypted on the phone with AES-256-GCM, key derived from the passphrase (PBKDF2-SHA-256, 310,000 iterations), compressed first. GitHub sees only ciphertext plus the phone name and time of each sync (in the commit history).
- The token and passphrase are stored only in that phone's app storage and never included in backups. *Stop syncing on this phone* removes them. Revoke a token on GitHub if a phone is lost.
- Network requests go only to `api.github.com`, only when sync is set up.
- The repository keeps every version in its history, which doubles as an off-phone backup. Old versions are still encrypted.

## Limits

- Needs internet to sync (the app itself does not).
- If the passphrase is changed on one phone, the other cannot read the file — set it up again on both with the new one.
- Very large histories are fine: the file is compressed; GitHub allows files far larger than this app produces.
