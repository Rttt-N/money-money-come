/**
 * 设置 MoneyMoneyCome 的 VRF callbackGasLimit（onlyOwner）
 *
 * 用法:
 *   npx hardhat run scripts/set-callback-gas.ts --network sepolia
 *
 * 可选环境变量:
 *   GAS_LIMIT=750000    # 默认 750000
 */

import { network } from "hardhat";
import fs from "fs";
import path from "path";

const { viem } = await network.connect();

async function main() {
  const publicClient = await viem.getPublicClient();
  const [owner] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  const newLimit = Number(process.env.GAS_LIMIT ?? "750000");

  const addressesPath = path.join(process.cwd(), "frontend/lib/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("addresses.json not found. Deploy first.");
  }
  const addrs = JSON.parse(fs.readFileSync(addressesPath, "utf-8"))[chainId.toString()];
  if (!addrs?.mmc) throw new Error(`No deployment found for chainId ${chainId}`);

  const mmc = await viem.getContractAt("MoneyMoneyCome", addrs.mmc);

  const current = await mmc.read.callbackGasLimit();
  console.log(`MoneyMoneyCome   : ${addrs.mmc}`);
  console.log(`Current gas limit: ${current}`);
  console.log(`Setting to       : ${newLimit}...`);

  const tx = await mmc.write.setCallbackGasLimit([newLimit], { account: owner.account });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const updated = await mmc.read.callbackGasLimit();
  console.log(`✓ Done. New callbackGasLimit: ${updated}`);
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
