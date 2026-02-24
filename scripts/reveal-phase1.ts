#!/usr/bin/env bun
/**
 * Phase 1 resolution: fetch submissions, decrypt, build merkle, post revealInfoPhase.
 *
 * Usage:
 *   bun run scripts/reveal-phase1.ts <marketId>
 *
 * Environment:
 *   MARKET_ADDRESS   Contract (or from deployed-addresses.json)
 *   RPC_URL          RPC endpoint
 *   PRIVATE_KEY      Signer (must be CRE forwarder for revealInfoPhase)
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { CREWorkflow } from "../ts/src/cre/workflow";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: bun run scripts/reveal-phase1.ts <marketId>");
    process.exit(1);
  }

  const marketId = BigInt(args[0]);
  const rpcUrl = process.env.RPC_URL ?? "https://sepolia.base.org";
  let contractAddress = process.env.MARKET_ADDRESS;

  if (!contractAddress) {
    const deployedPath = resolve(process.cwd(), "deployed-addresses.json");
    if (existsSync(deployedPath)) {
      const deployed = JSON.parse(readFileSync(deployedPath, "utf-8"));
      contractAddress = deployed.baseSepolia?.MiniMarket;
    }
  }

  if (!contractAddress) {
    console.error("Set MARKET_ADDRESS or have deployed-addresses.json");
    process.exit(1);
  }

  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey?.startsWith("0x")) privateKey = "0x" + (privateKey ?? "");
  if (!privateKey || privateKey === "0x") {
    console.error("Set PRIVATE_KEY (export from keystore: cast wallet export chack)");
    process.exit(1);
  }

  const workflow = new CREWorkflow({
    contractAddress: contractAddress as `0x${string}`,
    privateKey: privateKey as `0x${string}`,
    rpcUrl,
  });

  console.log("Processing market", marketId.toString(), "at", contractAddress, "...");
  console.log("Fetching encrypted submissions from contract...");
  const { result, txHash } = await workflow.processAndReveal(marketId);
  console.log("Reveal submitted:", txHash);
  console.log("Consensus:", result.consensusOutcome === 1 ? "YES" : "NO");
  console.log("Valid submissions:", result.validSubmissions.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
