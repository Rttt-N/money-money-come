/**
 * Verify all contracts on Sepolia Etherscan.
 *
 * Prerequisites:
 *   1. Add ETHERSCAN_API_KEY to .env
 *   2. Contracts already deployed to Sepolia
 *
 * Usage:
 *   npx hardhat run scripts/verify-sepolia.ts --network sepolia
 */

import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SEPOLIA = {
  aavePool: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
  usdc: "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8",
  aToken: "0x16dA4541aD1807f4443d92D26044C1147406EB80",
  vrfCoord: "0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B",
  vrfKeyHash:
    "0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae",
} as const;

async function main() {
  const { viem } = await network.connect();
  const [deployer] = await viem.getWalletClients();
  const deployerAddr = deployer.account.address;

  const addressesPath = path.join(__dirname, "../frontend/lib/addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"))[
    "11155111"
  ];

  if (!addresses) {
    throw new Error("No Sepolia addresses found in addresses.json");
  }

  const vrfSubId = process.env.VRF_SUBSCRIPTION_ID;
  if (!vrfSubId) {
    throw new Error("VRF_SUBSCRIPTION_ID not set in .env");
  }

  console.log("Deployer:", deployerAddr);
  console.log("Addresses:", addresses);
  console.log("");

  const contracts = [
    {
      name: "YieldVault",
      address: addresses.vault,
      args: [SEPOLIA.usdc, SEPOLIA.aavePool, SEPOLIA.aToken, deployerAddr],
    },
    {
      name: "SquadRegistry",
      address: addresses.squadRegistry,
      args: [deployerAddr],
    },
    {
      name: "TicketNFT",
      address: addresses.ticketNFT,
      args: [deployerAddr],
    },
    {
      name: "MoneyMoneyCome",
      address: addresses.mmc,
      args: [
        SEPOLIA.usdc,
        addresses.vault,
        addresses.ticketNFT,
        addresses.squadRegistry,
        SEPOLIA.vrfCoord,
        SEPOLIA.vrfKeyHash,
        vrfSubId,
        deployerAddr,
      ],
    },
  ];

  for (const c of contracts) {
    console.log(`\n${"━".repeat(50)}`);
    console.log(`Verifying ${c.name} at ${c.address}...`);
    const argsStr = c.args.map((a) => `"${a}"`).join(" ");
    const cmd = `npx hardhat verify --network sepolia ${c.address} ${argsStr}`;
    console.log(`> ${cmd}\n`);

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        stdio: "pipe",
        cwd: path.join(__dirname, ".."),
      });
      console.log(output);
      console.log(`${c.name} verified!`);
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      // "Already verified" is not a real error
      const msg = (e.stdout || "") + (e.stderr || "");
      if (msg.includes("Already Verified") || msg.includes("already verified")) {
        console.log(`${c.name} already verified.`);
      } else {
        console.error(`Failed to verify ${c.name}:`);
        console.error(msg || e.message);
      }
    }
  }

  console.log(`\n${"━".repeat(50)}`);
  console.log("Done! Check your contracts on Sepolia Etherscan:");
  console.log(`  MMC:           https://sepolia.etherscan.io/address/${addresses.mmc}#code`);
  console.log(`  YieldVault:    https://sepolia.etherscan.io/address/${addresses.vault}#code`);
  console.log(`  SquadRegistry: https://sepolia.etherscan.io/address/${addresses.squadRegistry}#code`);
  console.log(`  TicketNFT:     https://sepolia.etherscan.io/address/${addresses.ticketNFT}#code`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
