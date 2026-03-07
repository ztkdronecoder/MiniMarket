#!/usr/bin/env bun
/**
 * Claim shares (post Phase 1) and/or payouts (post Phase 2) for fake agents.
 * Uses FakeAgentFactory.execute to call as each agent.
 *
 * Shares can only be claimed when submarket phase = TRADING (before resolution).
 * Payouts can only be claimed when submarket phase = RESOLVED.
 *
 * Environment:
 *   MARKET_ADDRESS   MiniMarket contract
 *   FACTORY_ADDRESS  FakeAgentFactory (required)
 *   RPC_URL          RPC endpoint
 *   MARKET_ID        Market ID (or from phase1-output.json)
 *   PHASE1_OUTPUT    Path to phase1-output.json (default: scripts/phase-1-test/phase1-output.json)
 *   KEYSTORE + KEYSTORE_PASSWORD or PRIVATE_KEY
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { createPublicClient, createWalletClient, http, encodeFunctionData, keccak256, encodePacked } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Wallet } from "ethers";
import { baseSepolia } from "viem/chains";
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { MINIMARKET_ABI } from "../ts/src/market/abi";

const FACTORY_ABI = [
  {
    type: "function",
    name: "getAgentAddress",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "index", type: "uint256" },
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ type: "bytes" }],
    stateMutability: "nonpayable",
  },
] as const;

const LOCALHOST_CHAIN = { id: 31337, name: "Localhost", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } };

function getChain(rpcUrl: string, chainId?: string) {
  if (chainId === "84532" || rpcUrl.includes("sepolia")) return baseSepolia;
  return LOCALHOST_CHAIN as typeof baseSepolia;
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const marketAddress = process.env.MARKET_ADDRESS;
  const factoryAddress = process.env.FACTORY_ADDRESS;

  if (!marketAddress || !factoryAddress) {
    console.error("Set MARKET_ADDRESS and FACTORY_ADDRESS");
    process.exit(1);
  }

  const phase1Path = process.env.PHASE1_OUTPUT ?? resolve(process.cwd(), "tools/scripts/phase-1-test/phase1-output.json");
  if (!existsSync(phase1Path)) {
    console.error("Phase 1 output not found:", phase1Path);
    process.exit(1);
  }

  const phase1 = JSON.parse(readFileSync(phase1Path, "utf-8"));
  const marketId = BigInt(process.env.MARKET_ID ?? phase1.marketId);

  type SubmarketEntry = { index: number; submarketId: string; label: string; leaves: Array<{ agent: string; yesShares: string; noShares: string }> };
  const submarkets: SubmarketEntry[] = phase1.submarkets ?? [{ index: 0, submarketId: phase1.submarketId ?? "", label: "YES/NO", leaves: phase1.leaves ?? [] }];

  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey?.startsWith("0x")) privateKey = "0x" + (privateKey ?? "");
  if (!privateKey || privateKey === "0x") {
    const keystorePath = process.env.KEYSTORE ?? join(process.env.HOME ?? "~", ".foundry", "keystores", "chack");
    const password = process.env.KEYSTORE_PASSWORD;
    if (!password) {
      console.error("Set PRIVATE_KEY or KEYSTORE_PASSWORD");
      process.exit(1);
    }
    const wallet = await Wallet.fromEncryptedJson(readFileSync(keystorePath, "utf-8"), password);
    privateKey = wallet.privateKey;
  }

  const chain = getChain(rpcUrl, process.env.CHAIN_ID);
  const publicClient = createPublicClient({ chain: chain as any, transport: http(rpcUrl) });
  const deployerAccount = privateKeyToAccount(privateKey as `0x${string}`);
  const deployerWallet = createWalletClient({ chain: chain as any, transport: http(rpcUrl), account: deployerAccount });

  // Map agent address → factory index
  const agentIndexByAddress = new Map<string, number>();
  for (let i = 0; i < 20; i++) {
    const addr = await publicClient.readContract({
      address: factoryAddress as `0x${string}`,
      abi: FACTORY_ABI,
      functionName: "getAgentAddress",
      args: [BigInt(i)],
    });
    agentIndexByAddress.set(addr.toLowerCase(), i);
  }

  // Get submarket phases from contract
  const submarketPhases = new Map<string, number>();
  for (const sm of submarkets) {
    const sid = sm.submarketId.startsWith("0x") ? sm.submarketId : `0x${sm.submarketId}`;
    const state = await publicClient.readContract({
      address: marketAddress as `0x${string}`,
      abi: MINIMARKET_ABI,
      functionName: "submarketStates",
      args: [sid as `0x${string}`],
    }) as any;
    const phase = Number(state?.phase ?? state?.[0] ?? 0);
    submarketPhases.set(sid.toLowerCase(), phase);
  }

  const tradingSubmarketIds: `0x${string}`[] = [];
  const resolvedSubmarketIds: `0x${string}`[] = [];
  for (const sm of submarkets) {
    const sid = (sm.submarketId.startsWith("0x") ? sm.submarketId : `0x${sm.submarketId}`) as `0x${string}`;
    const phase = submarketPhases.get(sid.toLowerCase()) ?? 0;
    if (phase === 1) tradingSubmarketIds.push(sid);
    if (phase === 2) resolvedSubmarketIds.push(sid);
  }

  const allSubmarketIds = submarkets.map((s) => (s.submarketId.startsWith("0x") ? s.submarketId : `0x${s.submarketId}`) as `0x${string}`);

  // Gather all agents from leaves
  const allAgents = new Set<string>();
  for (const sm of submarkets) {
    for (const leaf of sm.leaves) allAgents.add(leaf.agent.toLowerCase());
  }

  for (const agentAddr of allAgents) {
    const agentKey = agentAddr.toLowerCase();
    const agentIndex = agentIndexByAddress.get(agentKey);
    if (agentIndex === undefined) {
      console.warn(`   Skip ${agentAddr.slice(0, 10)}... (not a factory agent)`);
      continue;
    }

    // 1. Claim shares (only for submarkets in TRADING)
    if (tradingSubmarketIds.length > 0) {
      const claimSubmarketIds: `0x${string}`[] = [];
      const claimProofs: Array<{ root: `0x${string}`; proof: `0x${string}`[]; index: bigint; agent: `0x${string}`; yesShares: bigint; noShares: bigint }> = [];

      for (const sm of submarkets) {
        const sid = (sm.submarketId.startsWith("0x") ? sm.submarketId : `0x${sm.submarketId}`) as `0x${string}`;
        if (submarketPhases.get(sid.toLowerCase()) !== 1) continue;

        const leafIdx = sm.leaves.findIndex((l) => l.agent.toLowerCase() === agentKey);
        if (leafIdx < 0) continue;
        const leaf = sm.leaves[leafIdx];
        const yesShares = BigInt(leaf.yesShares);
        const noShares = BigInt(leaf.noShares);
        if (yesShares === 0n && noShares === 0n) continue;

        const leafHash = keccak256(encodePacked(["address", "uint256", "uint256"], [leaf.agent as `0x${string}`, yesShares, noShares]));
        const leafHashes = sm.leaves.map((l) =>
          keccak256(encodePacked(["address", "uint256", "uint256"], [l.agent as `0x${string}`, BigInt(l.yesShares), BigInt(l.noShares)]))
        );
        const tree = SimpleMerkleTree.of(leafHashes);
        const proof = tree.getProof(leafIdx) as `0x${string}`[];

        claimSubmarketIds.push(sid);
        claimProofs.push({
          root: tree.root as `0x${string}`,
          proof,
          index: BigInt(leafIdx),
          agent: leaf.agent as `0x${string}`,
          yesShares,
          noShares,
        });
      }

      if (claimSubmarketIds.length > 0) {
        try {
          const claimData = encodeFunctionData({
            abi: MINIMARKET_ABI,
            functionName: "batchClaimShares",
            args: [claimSubmarketIds, claimProofs],
          });
          const { request } = await publicClient.simulateContract({
            address: factoryAddress as `0x${string}`,
            abi: FACTORY_ABI,
            functionName: "execute",
            args: [BigInt(agentIndex), marketAddress as `0x${string}`, 0n, claimData],
            account: deployerAccount,
          });
          const hash = await deployerWallet.writeContract(request);
          console.log(`   batchClaimShares agent[${agentIndex}] ${agentAddr.slice(0, 10)}...: ${hash.slice(0, 16)}...`);
        } catch (e) {
          console.error(`   batchClaimShares failed for ${agentAddr}:`, (e as Error).message?.slice(0, 80));
        }
      }
    }

    // 2. Claim payouts (only for submarkets in RESOLVED)
    if (resolvedSubmarketIds.length > 0) {
      try {
        const claimData = encodeFunctionData({
          abi: MINIMARKET_ABI,
          functionName: "batchClaimPayout",
          args: [allSubmarketIds],
        });
        const { request } = await publicClient.simulateContract({
          address: factoryAddress as `0x${string}`,
          abi: FACTORY_ABI,
          functionName: "execute",
          args: [BigInt(agentIndex), marketAddress as `0x${string}`, 0n, claimData],
          account: deployerAccount,
        });
        const hash = await deployerWallet.writeContract(request);
        console.log(`   batchClaimPayout agent[${agentIndex}] ${agentAddr.slice(0, 10)}...: ${hash.slice(0, 16)}...`);
      } catch (e) {
        // Contract skips agents with no winning shares — may revert or succeed with no effect
        const msg = (e as Error).message ?? "";
        if (!msg.includes("NothingToClaim") && !msg.includes("winning")) {
          console.error(`   batchClaimPayout failed for ${agentAddr}:`, msg.slice(0, 80));
        }
      }
    }
  }

  if (tradingSubmarketIds.length === 0 && resolvedSubmarketIds.length === 0) {
    console.log("   No submarkets in TRADING or RESOLVED phase. Nothing to claim.");
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
