/**
 * Simulate Aave yield for local testing.
 * Reads deployed addresses from frontend/lib/addresses.json, so no manual address input is needed.
 *
 * Usage:
 *   npx hardhat run scripts/simulate-yield.ts --network localhost
 *
 * Optional env vars:
 *   YIELD_AMOUNT=20        # amount in USDC (default: 20)
 */
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { viem } = await network.connect();

async function main() {
  const addressesPath = path.join(__dirname, "../frontend/lib/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("Please run deploy first: npx hardhat run scripts/deploy.ts --network localhost");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
  const chain = addresses["31337"];
  const mmcAddress = chain?.mmc as `0x${string}` | undefined;
  const vaultAddress = chain?.vault as `0x${string}` | undefined;

  if (!mmcAddress || !vaultAddress) {
    console.error("Missing mmc/vault address in frontend/lib/addresses.json. Please deploy contracts first.");
    process.exit(1);
  }

  const amountUsdc = process.env.YIELD_AMOUNT ? BigInt(process.env.YIELD_AMOUNT) : 20n;
  if (amountUsdc <= 0n) {
    console.error("YIELD_AMOUNT must be greater than 0");
    process.exit(1);
  }

  const mmc = await viem.getContractAt("MoneyMoneyCome", mmcAddress);
  const vaultFromMmc = await mmc.read.vault();
  if (vaultFromMmc.toLowerCase() !== vaultAddress.toLowerCase()) {
    console.warn("Warning: vault in addresses.json differs from mmc.vault(). Using mmc.vault().");
  }

  const vault = await viem.getContractAt("YieldVault", vaultFromMmc);
  const aTokenAddr = await vault.read.aToken();
  const aToken = await viem.getContractAt("MockAToken", aTokenAddr);

  const amount = amountUsdc * 10n ** 6n; // USDC has 6 decimals
  await aToken.write.simulateYield([vaultFromMmc, amount]);

  console.log(`Simulated +${amountUsdc.toString()} USDC yield to vault ${vaultFromMmc}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

