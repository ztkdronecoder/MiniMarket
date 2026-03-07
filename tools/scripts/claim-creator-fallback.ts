#!/usr/bin/env bun
/**
 * Claim creator fallback when everyone bet 100% on the wrong outcome.
 * No one has winning shares → pool is locked. Creator can reclaim it.
 *
 * Usage:
 *   MARKET_ADDRESS=0x... SUBMARKET_ID=0x... RPC_URL=... PRIVATE_KEY=0x... bun run scripts/claim-creator-fallback.ts
 *
 * Or with market ID (claims all submarkets that qualify):
 *   MARKET_ADDRESS=0x... MARKET_ID=2 RPC_URL=... PRIVATE_KEY=0x... bun run scripts/claim-creator-fallback.ts
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { MINIMARKET_ABI } from "../ts/src/market/abi";

const LOCALHOST_CHAIN = {
  id: 31337,
  name: "Localhost",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
} as const;

function getChain(rpcUrl: string, chainId?: string) {
  if (chainId === "84532" || rpcUrl.includes("sepolia")) return baseSepolia;
  return LOCALHOST_CHAIN as typeof baseSepolia;
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const marketAddress = process.env.MARKET_ADDRESS as `0x${string}`;
  const submarketId = process.env.SUBMARKET_ID as `0x${string}` | undefined;
  const marketId = process.env.MARKET_ID ? BigInt(process.env.MARKET_ID) : undefined;

  if (!marketAddress) {
    console.error("Set MARKET_ADDRESS");
    process.exit(1);
  }

  if (!submarketId && !marketId) {
    console.error("Set SUBMARKET_ID (bytes32 hex) or MARKET_ID to claim all qualifying submarkets");
    process.exit(1);
  }

  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey?.startsWith("0x")) privateKey = "0x" + (privateKey ?? "");
  if (!privateKey || privateKey === "0x") {
    console.error("Set PRIVATE_KEY (creator wallet)");
    process.exit(1);
  }

  const chain = getChain(rpcUrl, process.env.CHAIN_ID);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain, transport });

  const getSubmarketId = async (parentId: bigint, optionIndex: number) => {
    return publicClient.readContract({
      address: marketAddress,
      abi: MINIMARKET_ABI,
      functionName: "getSubmarketId",
      args: [parentId, BigInt(optionIndex)],
    }) as Promise<`0x${string}`>;
  };

  const submarketIds: `0x${string}`[] = [];
  if (submarketId) {
    submarketIds.push(submarketId.startsWith("0x") ? submarketId : (`0x${submarketId}` as `0x${string}`));
  } else if (marketId !== undefined) {
    const config = await publicClient.readContract({
      address: marketAddress,
      abi: MINIMARKET_ABI,
      functionName: "configs",
      args: [marketId],
    }) as { optionCount: bigint };
    const n = Number(config?.optionCount ?? 1);
    for (let i = 0; i < n; i++) {
      submarketIds.push(await getSubmarketId(marketId, i));
    }
  }

  for (const sid of submarketIds) {
    try {
      const hash = await walletClient.writeContract({
        address: marketAddress,
        abi: MINIMARKET_ABI,
        functionName: "claimCreatorFallback",
        args: [sid],
      });
      console.log(`Claimed creator fallback for submarket ${sid}: ${hash}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("CreatorFallbackNotApplicable") || msg.includes("totalWinning")) {
        console.log(`Submarket ${sid}: not a 100/0 case (has winning shares), skipping`);
      } else if (msg.includes("CreatorFallbackAlreadyClaimed")) {
        console.log(`Submarket ${sid}: already claimed, skipping`);
      } else if (msg.includes("NotCreator")) {
        console.error(`Submarket ${sid}: caller is not the market creator`);
      } else {
        console.error(`Submarket ${sid}: ${msg}`);
      }
    }
  }
}

main();
