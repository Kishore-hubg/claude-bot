# Teams App Package

This folder contains the Teams app manifest for the Claude Assistant Bot.

## Files required by Teams

- `manifest.json` (already added)
- `color.png` (192x192)
- `outline.png` (32x32)

## Before upload

1. `manifest.json` is prefilled with:
   - Teams app package id (`id`) = generated UUID
   - `botId` = `TEAMS_APP_ID` from backend configuration
2. Replace only the remaining domain placeholder in `manifest.json`:
   - `REPLACE_WITH_BACKEND_DOMAIN` -> backend public domain only (for example, `claude-bot-api.vercel.app`)
   - Do not include protocol (`https://`) or path
3. Add the icon PNG files listed above.
4. Zip these files at folder root (no nested parent folder):
   - `manifest.json`
   - `color.png`
   - `outline.png`

## Upload options

- Teams Admin Center -> Teams apps -> Manage apps -> Upload new app
- Or Teams client (Developer preview / sideload) for test tenant
