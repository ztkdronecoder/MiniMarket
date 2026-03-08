# Deploying Cortex Indexer to Railway

Railway uses **Railpack** (Nixpacks is deprecated). Railpack auto-detects Node.js + pnpm from `pnpm-lock.yaml` and uses `packageManager` in `package.json` for the correct pnpm version via Corepack.

## Setup

1. **Create a new Railway project** and add a service from your GitHub repo.

2. **Set Root Directory** to `indexer` (Service → Settings → Root Directory).
   - Railway builds from the indexer folder.

3. **Environment variables** (Service → Variables):
   ```
   NETWORK=base_sepolia
   RPC_URL=https://sepolia.base.org
   CONTRACT_ADDRESS=0xBaf1133fcB942D9Df3BAFE782D553646D0a13D79
   ORDERBOOK_ADDRESS=0x5DD8f78Ea4b173d1077956F0199D23e9931eD888
   START_BLOCK=38571434
   ```

4. **Build & Start** – leave as default. Railpack will:
   - **Install:** `pnpm install` (uses pnpm 9 via `packageManager` + Corepack)
   - **Build:** `pnpm run build` (ponder codegen)
   - **Start:** `pnpm start` (ponder start, binds to `$PORT`)

## If install still fails

If you hit lockfile/version issues, add a `railpack.json` to override the install step:

```json
{
  "$schema": "https://schema.railpack.com",
  "steps": {
    "install": {
      "commands": ["corepack enable", "corepack prepare pnpm@9.15.0 --activate", "pnpm install"]
    }
  }
}
```

## Exposing the API

Railway sets `PORT`. The start script uses `ponder start -p ${PORT:-42069}` so the API binds to Railway's port and is reachable at the generated URL.
