/**
 * Diagnose enterGame failure on Sepolia.
 * Simulates the call to get the exact revert reason.
 *
 * Usage:
 *   npx hardhat run scripts/diagnose-sepolia.ts --network sepolia
 */

import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseAbi, formatUnits } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const { viem } = await network.connect();
  const [wallet] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const user = wallet.account.address;

  const addressesPath = path.join(__dirname, "../frontend/lib/addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"))["11155111"];

  console.log("━".repeat(60));
  console.log("  Sepolia Diagnostics");
  console.log(`  User: ${user}`);
  console.log("━".repeat(60));

  const usdc = addresses.usdc;
  const mmc = addresses.mmc;
  const vault = addresses.vault;

  const erc20Abi = parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ]);

  // 1. Check USDC balance
  const balance = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [user],
  });
  console.log(`\n[1] USDC Balance: ${formatUnits(balance, 6)} USDC`);

  // 2. Check USDC allowance to MMC
  const allowance = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [user, mmc],
  });
  console.log(`[2] USDC Allowance to MMC: ${formatUnits(allowance, 6)} USDC`);

  // 3. Check MMC contract's USDC allowance to Vault
  const mmcToVaultAllowance = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [mmc, vault],
  });
  console.log(`[3] MMC→Vault USDC Allowance: ${formatUnits(mmcToVaultAllowance, 6)} USDC`);

  // 4. Check Vault's USDC allowance to AavePool
  const aavePool = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";
  const vaultToAaveAllowance = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [vault, aavePool],
  });
  console.log(`[4] Vault→AavePool USDC Allowance: ${formatUnits(vaultToAaveAllowance, 6)} USDC`);

  // 5. Check Vault totalAssets
  const vaultAbi = parseAbi([
    "function totalAssets() view returns (uint256)",
    "function owner() view returns (address)",
  ]);
  const totalAssets = await publicClient.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: "totalAssets",
    args: [],
  });
  console.log(`[5] Vault totalAssets: ${formatUnits(totalAssets, 6)} USDC`);

  const vaultOwner = await publicClient.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: "owner",
    args: [],
  });
  console.log(`[6] Vault owner: ${vaultOwner}`);
  console.log(`    MMC address: ${mmc}`);
  console.log(`    Match: ${vaultOwner.toLowerCase() === mmc.toLowerCase()}`);

  // 6. Check round info
  const mmcAbi = parseAbi([
    "function currentRound() view returns (uint256)",
    "function rounds(uint256) view returns (uint256,uint256,uint256,uint256,uint256,uint8,address)",
    "function enterGame(uint256,uint8,uint256)",
  ]);

  const currentRound = await publicClient.readContract({
    address: mmc,
    abi: mmcAbi,
    functionName: "currentRound",
    args: [],
  });

  const round = await publicClient.readContract({
    address: mmc,
    abi: mmcAbi,
    functionName: "rounds",
    args: [currentRound],
  });
  const endTime = Number(round[1]);
  const now = Math.floor(Date.now() / 1000);
  console.log(`[7] Round ${currentRound}: state=${round[5]}, endTime=${endTime}, now=${now}, remaining=${endTime - now}s (${((endTime - now)/3600).toFixed(1)}h)`);

  // 7. Simulate enterGame
  if (balance < 10_000_000n) {
    console.log(`\n[!] USDC balance too low (${formatUnits(balance, 6)}). Need at least 10 USDC.`);
    console.log("    Get test USDC from: https://faucets.chain.link/sepolia-aave");
  }

  if (balance >= 10_000_000n) {
    const testAmount = 10_000_000n; // 10 USDC
    console.log(`\n[8] Simulating enterGame(${formatUnits(testAmount, 6)} USDC, tier=1, squad=0)...`);

    try {
      await publicClient.simulateContract({
        address: mmc,
        abi: mmcAbi,
        functionName: "enterGame",
        args: [testAmount, 1, 0n],
        account: user,
      });
      console.log("    Simulation SUCCESS! The call should work.");
    } catch (err: unknown) {
      const e = err as { message?: string; cause?: { reason?: string; data?: string } };
      console.log("    Simulation FAILED!");
      console.log("    Error:", e.message?.slice(0, 500));
      if (e.cause?.reason) {
        console.log("    Revert reason:", e.cause.reason);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
