#!/usr/bin/env bun
/**
 * Cast an encrypted vote (Phase1 price discovery) on Cortex.
 *
 * Usage:
 *   bun run scripts/cast-vote.ts <marketId> <yesPercent> [options]
 *
 * Examples:
 *   bun run scripts/cast-vote.ts 1 700    # 70% yes, 30% no
 *   bun run scripts/cast-vote.ts 1 500     # 50% yes, 50% no
 *
 * Environment:
 *   MARKET_ADDRESS   Contract address (or from deployed-addresses.json)
 *   PRIVATE_KEY      Signer private key
 *   RPC_URL          RPC endpoint (default: https://sepolia.base.org)
 */

import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { Wallet } from "ethers";
import {
  encryptPredictionBasisPoints,
  computeValidationHashBasisPoints,
  type PredictionPayloadBasisPoints,
} from "../ts/src/drand/encryption";
import { DRAND_QUICKNET } from "../ts/src/drand/network";
import { MINIMARKET_ABI } from "../ts/src/market/abi";

const BASIS_POINTS = 1000;

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: bun run scripts/cast-vote.ts <marketId> <yesPercent> [--rpc URL] [--key PATH]");
    console.error("  yesPercent: 0-1000 (e.g. 700 = 70% yes, 30% no)");
    process.exit(1);
  }

  const marketId = BigInt(args[0]);
  const yesPercent = parseInt(args[1], 10);
  const noPercent = BASIS_POINTS - yesPercent;

  if (yesPercent < 0 || yesPercent > BASIS_POINTS || noPercent < 0) {
    console.error("yesPercent must be 0-1000");
    process.exit(1);
  }

  const rpcIdx = args.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? args[rpcIdx + 1] : process.env.RPC_URL ?? "https://sepolia.base.org";

  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    const keystorePath = process.env.KEYSTORE ?? join(process.env.HOME ?? "~", ".foundry", "keystores", "chack");
    const password = process.env.KEYSTORE_PASSWORD;
    if (!password) {
      console.error("Set KEYSTORE_PASSWORD (or PRIVATE_KEY) to sign transactions");
      process.exit(1);
    }
    const keystoreJson = readFileSync(keystorePath, "utf-8");
    process.stdout.write("Decrypting keystore...\n");
    const wallet = await Wallet.fromEncryptedJson(keystoreJson, password);
    privateKey = wallet.privateKey;
  }
  if (!privateKey.startsWith("0x")) privateKey = "0x" + privateKey;

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  let marketAddress = process.env.MARKET_ADDRESS;
  if (!marketAddress) {
    const deployedPath = resolve(process.cwd(), "deployed-addresses.json");
    if (existsSync(deployedPath)) {
      const deployed = JSON.parse(readFileSync(deployedPath, "utf-8"));
      marketAddress = deployed.baseSepolia?.Cortex;
    }
  }
  if (!marketAddress) {
    console.error("Set MARKET_ADDRESS or have deployed-addresses.json");
    process.exit(1);
  }

  const chainId = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : 84532;
  const chain =
    chainId === 31337
      ? defineChain({ id: 31337, name: "Localhost", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } })
      : baseSepolia;

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain,
    transport: http(rpcUrl),
    account,
  });

  // Use env overrides to avoid configs read (viem can fail on bytes32 in configs with IntegerOutOfRangeError)
  let ticketCost: bigint;
  let drandTargetRound: bigint;
  if (process.env.TICKET_COST != null && process.env.DRAND_TARGET_ROUND != null) {
    ticketCost = BigInt(process.env.TICKET_COST);
    drandTargetRound = BigInt(process.env.DRAND_TARGET_ROUND);
  } else {
    const config = await publicClient.readContract({
      address: marketAddress as `0x${string}`,
      abi: MINIMARKET_ABI,
      functionName: "configs",
      args: [marketId],
    });
    const cfg = config as unknown as readonly [bigint, string, string, bigint, bigint, bigint, bigint, `0x${string}`, bigint, bigint];
    ticketCost = cfg[4];
    drandTargetRound = cfg[6];
  }

  const usdc = await publicClient.readContract({
    address: marketAddress as `0x${string}`,
    abi: MINIMARKET_ABI,
    functionName: "USDC",
  });

  if (!drandTargetRound) {
    console.error(`Market ${marketId} not found on-chain (drandTargetRound is 0). Check market ID and contract address.`);
    process.exit(1);
  }

  const salt = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");

  // Parse per-option votes from OPTION_VOTES env var (comma-separated yesPercent values, e.g. "700,500,300,100")
  const optionVotesStr = process.env.OPTION_VOTES;
  const optionPredictions: Array<{ index: number; yesPercent: number; noPercent: number }> | undefined =
    optionVotesStr
      ? optionVotesStr.split(",").map((s, i) => {
          const y = parseInt(s.trim(), 10);
          return { index: i, yesPercent: y, noPercent: BASIS_POINTS - y };
        })
      : undefined;

  // Use option 0's vote as the top-level yesPercent when multi-option
  const effectiveYes = optionPredictions ? optionPredictions[0].yesPercent : yesPercent;
  const effectiveNo = optionPredictions ? optionPredictions[0].noPercent : noPercent;

  const prediction: PredictionPayloadBasisPoints = {
    yesPercent: effectiveYes,
    noPercent: effectiveNo,
    agent: account.address,
    salt,
    ...(optionPredictions && optionPredictions.length > 1 ? { options: optionPredictions } : {}),
  };

  console.log("Encrypting prediction...");
  console.log(`  Agent: ${account.address}`);
  if (optionPredictions && optionPredictions.length > 1) {
    console.log(`  Multi-option votes:`);
    for (const op of optionPredictions) {
      console.log(`    Option ${op.index}: Yes=${op.yesPercent}bp (${(op.yesPercent / 10).toFixed(1)}%), No=${op.noPercent}bp`);
    }
  } else {
    console.log(`  Yes: ${effectiveYes}bp (${(effectiveYes / 10).toFixed(1)}%), No: ${effectiveNo}bp (${(effectiveNo / 10).toFixed(1)}%)`);
  }
  console.log(`  Target round: ${drandTargetRound}`);

  const encrypted = await encryptPredictionBasisPoints(prediction, drandTargetRound, DRAND_QUICKNET);

  const validationHash = computeValidationHashBasisPoints(prediction);
  const ciphertext = "0x" + Buffer.from(encrypted.ciphertext, "base64").toString("hex");

  console.log("\nApproving USDC and submitting to contract...");

  const ERC20_ABI = [
    { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  ] as const;

  const hash = await walletClient.writeContract({
    address: usdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [marketAddress as `0x${string}`, ticketCost],
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const submitHash = await walletClient.writeContract({
    address: marketAddress as `0x${string}`,
    abi: MINIMARKET_ABI,
    functionName: "submitEncrypted",
    args: [marketId, ciphertext as `0x${string}`, validationHash],
  });

  console.log(`\n✅ Vote cast! Tx: ${submitHash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
