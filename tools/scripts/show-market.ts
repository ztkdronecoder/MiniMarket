#!/usr/bin/env bun
/** Print market config from contract. Usage: bun run scripts/show-market.ts <marketId> */
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

async function main() {
  const marketId = BigInt(process.argv[2] || "1");
  const rpcUrl = process.env.RPC_URL ?? "https://sepolia.base.org";

  let addr = process.env.MARKET_ADDRESS;
  if (!addr) {
    const p = resolve(ROOT, "deployed-addresses.json");
    if (existsSync(p)) addr = JSON.parse(readFileSync(p, "utf-8")).baseSepolia?.Cortex;
  }
  if (!addr) {
    console.error("Set MARKET_ADDRESS or deployed-addresses.json");
    process.exit(1);
  }

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const [marketId_, question, schemaJson, maxSlots, ticketCost, marketCap, drandTargetRound, , createdAt, tradingDuration] =
    await client.readContract({
      address: addr as `0x${string}`,
      abi: parseAbi(["function configs(uint256) view returns (uint256, string, string, uint256, uint256, uint256, uint64, bytes32, uint48, uint48)"]),
      functionName: "configs",
      args: [marketId],
    });
  const drandGenesis = 1692803367;
  const drandPeriod = 3;
  const revealTs = Number(drandTargetRound) * drandPeriod + drandGenesis;
  const revealDate = new Date(revealTs * 1000).toISOString();

  console.log("");
  console.log("  Contract:           ", addr);
  console.log("  Question:           ", question);
  console.log("  Schema JSON:        ", schemaJson);
  console.log("  Token:              USDC");
  console.log("  Max slots:          ", maxSlots.toString());
  console.log("  Ticket cost:        ", (Number(ticketCost) / 1e6).toFixed(6), "USDC (" + ticketCost + " units)");
  console.log("  Market cap:         ", (Number(marketCap) / 1e6).toFixed(6), "USDC (" + marketCap + " units)");
  console.log("  Reveal at:          Round", drandTargetRound.toString(), "(~" + revealDate + ")");
  console.log("  Trading duration:   ", tradingDuration.toString(), "seconds");
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
