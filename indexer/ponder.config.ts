import { createConfig } from "ponder";
import { http } from "viem";
import { readFileSync } from "fs";

const MiniMarketAbi = JSON.parse(readFileSync("./abis/MiniMarket.json", "utf-8"));

export default createConfig({
  chains: {
    localhost: {
      id: 31337,
      rpc: "http://127.0.0.1:8545",
    },
  },
  contracts: {
    MiniMarket: {
      chain: "localhost",
      abi: MiniMarketAbi,
      address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      startBlock: 1,
    },
  },
});
