#!/usr/bin/env node
/**
 * Apply Pglite string serializer fix for Buffer/Uint8Array.
 * Pglite throws "Invalid input for string type" when serialize receives Buffer (from bytea reads).
 * Triggered when demo script fires many OrderPlaced/OrderFilled events in quick succession.
 * Runs after pnpm install.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(join(root, "package.json"));

let target = null;
try {
  const pkgPath = require.resolve("@electric-sql/pglite/package.json");
  target = join(dirname(pkgPath), "src", "types.ts");
  if (!existsSync(target)) target = null;
} catch (_) {}

if (!target) {
  console.warn("patch-pglite: @electric-sql/pglite not found, skipping");
  process.exit(0);
}

let content = readFileSync(target, "utf8");
const bad = `throw new Error('Invalid input for string type')`;
const good = `if (x == null || x === undefined) return ''
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(x)) return '0x' + x.toString('hex')
        if (x instanceof Uint8Array) return '0x' + Buffer.from(x).toString('hex')
        return String(x)`;

if (content.includes(bad)) {
  content = content.replace(bad, good);
  writeFileSync(target, content);
  console.log("patch-pglite: applied fix to", target);
} else if (content.includes("Buffer.isBuffer(x)")) {
  console.log("patch-pglite: already patched");
} else {
  console.warn("patch-pglite: could not find target in", target);
}
