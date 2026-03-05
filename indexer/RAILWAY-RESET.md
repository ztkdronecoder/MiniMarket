# Reset indexer to re-index from START_BLOCK

If the indexer ignores `START_BLOCK` and starts from the wrong block, it's because **Ponder resumes from a checkpoint** on restart (crash recovery). The checkpoint overrides `startBlock`.

## Fix: Clear the checkpoint

1. Connect to your Railway Postgres (Variables → `DATABASE_URL`).
2. Find your schema name (from deploy logs: `schema=cb76bb33-5777-41ad-8c9d-ce68f6593cb3` or similar).
3. Run:

```sql
TRUNCATE TABLE "YOUR_SCHEMA_NAME"._ponder_checkpoint;
```

Replace `YOUR_SCHEMA_NAME` with the schema from your deploy logs (e.g. `cb76bb33-5777-41ad-8c9d-ce68f6593cb3`).

4. Redeploy or restart the indexer. It will start from `START_BLOCK` again.

## Alternative: Fresh database

Create a new Postgres database in Railway, update `DATABASE_URL`, and redeploy. A new schema will be created and indexing will start from `START_BLOCK`.
