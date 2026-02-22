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
      address: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
      startBlock: 1,
    },
  },
});
