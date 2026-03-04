import { createConfig } from "ponder";
import { readFileSync } from "fs";

// Foundry artifacts are { abi: [...] }; some ABIs are raw arrays
const loadAbi = (path: string) => {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Array.isArray(raw) ? raw : raw.abi;
};
const MiniMarketAbi = loadAbi("./abis/MiniMarket.json");
const OrderbookMarketAbi = loadAbi("./abis/OrderbookMarket.json");

const network    = process.env.NETWORK   ?? "local";
const isLocal    = network === "local";
const rpcUrl     = process.env.RPC_URL   ?? (isLocal ? "http://127.0.0.1:8545" : "https://sepolia.base.org");
const address    = (process.env.CONTRACT_ADDRESS ?? (isLocal
  ? "0x5FbDB2315678afecb367f032d93F642f64180aa3"
  : "0x7ca8fd1ad34f4411d8768a508889934175c33cae"
)) as `0x${string}`;
const orderbookAddress = process.env.ORDERBOOK_ADDRESS as `0x${string}` | undefined;
const startBlock = process.env.START_BLOCK ? parseInt(process.env.START_BLOCK, 10) : (isLocal ? 1 : 0);

const chain = isLocal ? "localhost" : "baseSepolia";

export default createConfig({
  chains: isLocal
    ? { localhost:   { id: 31337, rpc: rpcUrl } }
    : { baseSepolia: { id: 84532, rpc: rpcUrl } },
  contracts: {
    MiniMarket: {
      chain,
      abi: MiniMarketAbi,
      address,
      startBlock,
    },
    ...(orderbookAddress ? {
      OrderbookMarket: {
        chain,
        abi: OrderbookMarketAbi,
        address: orderbookAddress,
        startBlock,
      },
    } : {}),
  },
});
