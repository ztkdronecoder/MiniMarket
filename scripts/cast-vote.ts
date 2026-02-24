#!/usr/bin/env bun
/**
 * Cast an encrypted vote (Phase1 price discovery) on a MiniMarket.
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

import { createPublicClient, createWalletClient, http } from "viem";
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
      marketAddress = deployed.baseSepolia?.MiniMarket;
    }
  }
  if (!marketAddress) {
    console.error("Set MARKET_ADDRESS or have deployed-addresses.json");
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
    account,
  });

  const config = await publicClient.readContract({
    address: marketAddress as `0x${string}`,
    abi: MINIMARKET_ABI,
    functionName: "configs",
    args: [marketId],
  });

  // viem returns multi-output structs as a numeric-keyed object, not named properties
  // MarketConfig fields: [0]marketId [1]question [2]schemaURI [3]paymentToken
  //   [4]maxSlots [5]ticketCost [6]marketCap [7]drandTargetRound [8]drandChainHash
  //   [9]createdAt [10]tradingDuration
  const cfg = config as unknown as readonly [bigint, string, string, string, bigint, bigint, bigint, bigint, `0x${string}`, bigint, bigint];
  const ticketCost = cfg[5];
  const drandTargetRound = cfg[7];

  if (!drandTargetRound) {
    console.error(`Market ${marketId} not found on-chain (drandTargetRound is 0). Check market ID and contract address.`);
    process.exit(1);
  }

  const salt = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");

  const prediction: PredictionPayloadBasisPoints = {
    yesPercent,
    noPercent,
    agent: account.address,
    salt,
  };

  console.log("Encrypting prediction...");
  console.log(`  Agent: ${account.address}`);
  console.log(`  Yes: ${yesPercent}bp (${(yesPercent / 10).toFixed(1)}%), No: ${noPercent}bp (${(noPercent / 10).toFixed(1)}%)`);
  console.log(`  Target round: ${drandTargetRound}`);

  const encrypted = await encryptPredictionBasisPoints(prediction, drandTargetRound, DRAND_QUICKNET);

  const validationHash = computeValidationHashBasisPoints(prediction);
  const ciphertext = "0x" + Buffer.from(encrypted.ciphertext, "base64").toString("hex");

  console.log("\nSubmitting to contract...");

  const hash = await walletClient.writeContract({
    address: marketAddress as `0x${string}`,
    abi: MINIMARKET_ABI,
    functionName: "submitEncrypted",
    args: [marketId, ciphertext as `0x${string}`, validationHash],
    value: ticketCost,
  });

  console.log(`\n✅ Vote cast! Tx: ${hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
