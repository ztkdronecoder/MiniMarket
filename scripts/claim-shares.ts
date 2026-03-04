#!/usr/bin/env bun
/**
 * Claim Phase 1 shares for all participants. Uses same keys as simulate-phase1 (KEYS_FILE).
 *
 * Usage:
 *   bun run scripts/claim-shares.ts <marketId>
 *
 * Environment:
 *   MARKET_ADDRESS   Contract (or from deployed-addresses.json)
 *   RPC_URL          RPC endpoint
 *   KEYS_FILE        Path to file with one private key per line (same order as votes)
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { CREWorkflow } from "../ts/src/cre/workflow";
import { MINIMARKET_ABI } from "../ts/src/market/abi";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: bun run scripts/claim-shares.ts <marketId>");
    process.exit(1);
  }

  const marketId = BigInt(args[0]);
  const rpcUrl = process.env.RPC_URL ?? "https://sepolia.base.org";
  const keysFile = process.env.KEYS_FILE;

  if (!keysFile || !existsSync(keysFile)) {
    console.error("Set KEYS_FILE (path to file with one private key per line, same order as votes)");
    process.exit(1);
  }

  const keys: string[] = [];
  for (const line of readFileSync(keysFile, "utf-8").split("\n")) {
    const trimmed = line.replace(/#.*/, "").trim();
    if (trimmed) keys.push(trimmed.startsWith("0x") ? trimmed : "0x" + trimmed);
  }

  let contractAddress = process.env.MARKET_ADDRESS;
  if (!contractAddress) {
    const deployedPath = resolve(process.cwd(), "deployed-addresses.json");
    if (existsSync(deployedPath)) {
      const deployed = JSON.parse(readFileSync(deployedPath, "utf-8"));
      contractAddress = deployed.baseSepolia?.Cortex;
    }
  }
  if (!contractAddress) {
    console.error("Set MARKET_ADDRESS or have deployed-addresses.json");
    process.exit(1);
  }

  // Use first key for workflow (just to fetch/decrypt - we don't submit)
  const workflow = new CREWorkflow({
    contractAddress: contractAddress as `0x${string}`,
    privateKey: keys[0] as `0x${string}`,
    rpcUrl,
  });

  console.log("Fetching submissions and computing allocations...");
  const result = await workflow.processInfoReveal(marketId);

  console.log("\n=== Shares outcome per agent ===");
  for (let i = 0; i < result.leaves.length; i++) {
    const leaf = result.leaves[i];
    console.log(
      `Agent ${i + 1} (${leaf.agent}): yesShares=${leaf.yesShares.toString()}, noShares=${leaf.noShares.toString()}`
    );
  }

  if (keys.length < result.leaves.length) {
    console.error(`\nKEYS_FILE has ${keys.length} keys but ${result.leaves.length} participants. Need one key per participant.`);
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  for (let i = 0; i < result.leaves.length; i++) {
    const leaf = result.leaves[i];
    const proof = result.getProof(i);
    const account = privateKeyToAccount(keys[i] as `0x${string}`);

    if (account.address.toLowerCase() !== leaf.agent.toLowerCase()) {
      console.warn(`\nKey ${i + 1} address ${account.address} does not match leaf agent ${leaf.agent}`);
    }

    const walletClient = createWalletClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
      account,
    });

    const { request } = await publicClient.simulateContract({
      address: contractAddress as `0x${string}`,
      abi: MINIMARKET_ABI,
      functionName: "claimShares",
      args: [
        marketId,
        {
          root: result.merkleRoot,
          proof,
          index: BigInt(i),
          agent: leaf.agent,
          yesShares: leaf.yesShares,
          noShares: leaf.noShares,
        },
      ],
      account,
    });

    const hash = await walletClient!.writeContract(request);
    console.log(`\nClaimed for agent ${i + 1} (${leaf.agent}): tx ${hash}`);
  }

  console.log("\nAll claims submitted.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
