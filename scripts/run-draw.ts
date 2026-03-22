/**
 * Advance time and trigger performUpkeep without using console.
 *
 * Usage:
 *   npx hardhat run scripts/run-draw.ts --network localhost
 *
 * Optional env vars:
 *   ADVANCE_SECONDS=2
 */
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { viem, provider } = await network.connect();

async function main() {
  const addressesPath = path.join(__dirname, "../frontend/lib/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("Please deploy first: npx hardhat run scripts/deploy.ts --network localhost");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
  const mmcAddress = addresses["31337"]?.mmc as `0x${string}` | undefined;
  if (!mmcAddress || mmcAddress === "0x0000000000000000000000000000000000000000") {
    console.error("Missing mmc address in frontend/lib/addresses.json");
    process.exit(1);
  }

  const mmc = await viem.getContractAt("MoneyMoneyCome", mmcAddress);
  const seconds = process.env.ADVANCE_SECONDS ? Number(process.env.ADVANCE_SECONDS) : 2;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.error("ADVANCE_SECONDS must be a positive number");
    process.exit(1);
  }

  await provider.request({
    method: "evm_increaseTime",
    params: [Math.floor(seconds)],
  });
  await provider.request({ method: "evm_mine" });

  const [upkeepNeeded] = await mmc.read.checkUpkeep(["0x"]);
  console.log("checkUpkeep:", upkeepNeeded);
  if (!upkeepNeeded) {
    console.error("Upkeep not needed yet. Ensure round ended and has participants.");
    process.exit(1);
  }

  await mmc.write.performUpkeep(["0x"]);
  console.log("performUpkeep executed successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

