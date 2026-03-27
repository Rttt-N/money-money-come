import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

const SEPOLIA_RPC_URL     = process.env.SEPOLIA_RPC_URL     ?? "";
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY ?? "";

if (!SEPOLIA_RPC_URL || !SEPOLIA_PRIVATE_KEY) {
  // Only warn — local tasks don't need Sepolia vars
  if (process.argv.some((a) => a.includes("sepolia"))) {
    console.warn("⚠  SEPOLIA_RPC_URL or SEPOLIA_PRIVATE_KEY not set in .env");
  }
}

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: SEPOLIA_RPC_URL,
      accounts: SEPOLIA_PRIVATE_KEY ? [SEPOLIA_PRIVATE_KEY] : [],
      timeout: 120000,       // 2 分钟 RPC 超时（默认 20s 太短）
    },
  },
});
