#!/usr/bin/env bun
// Query market config (createdAt, tradingDuration) from MiniMarket
import { createPublicClient, http, decodeAbiParameters, parseAbiParameters } from "viem";
import { baseSepolia } from "viem/chains";

const ADDRESS = "0xB1d90E3E7099dbe35fe14F93f404eB8d03aE04a8" as const;
const RPC = "https://sepolia.base.org";

const configsAbi = [
  {
    type: "function",
    name: "configs",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "marketId", type: "uint256" },
          { name: "question", type: "string" },
          { name: "schemaJson", type: "string" },
          { name: "maxSlots", type: "uint256" },
          { name: "ticketCost", type: "uint256" },
          { name: "marketCap", type: "uint256" },
          { name: "creatorOffer", type: "uint256" },
          { name: "drandTargetRound", type: "uint64" },
          { name: "drandChainHash", type: "bytes32" },
          { name: "createdAt", type: "uint48" },
          { name: "tradingDuration", type: "uint48" },
          { name: "creator", type: "address" },
          { name: "optionCount", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC),
});

async function main() {
  const marketId = BigInt(process.argv[2] || "1");
  const config = await client.readContract({
    address: ADDRESS,
    abi: configsAbi,
    functionName: "configs",
    args: [marketId],
  });

  const [createdAt, tradingDuration] = [config[9], config[10]];
  const tradingEnd = Number(createdAt) + Number(tradingDuration);
  const now = Math.floor(Date.now() / 1000);

  console.log(JSON.stringify({
    marketId: Number(marketId),
    createdAt: Number(createdAt),
    tradingDuration: Number(tradingDuration),
    tradingEnd,
    tradingEndDate: new Date(tradingEnd * 1000).toISOString(),
    now,
    tradingComplete: now >= tradingEnd,
    secondsUntilComplete: Math.max(0, tradingEnd - now),
  }, null, 2));
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
