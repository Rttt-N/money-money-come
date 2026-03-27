/**
 * 设置 MoneyMoneyCome 的轮次时长（onlyOwner）
 *
 * 用法:
 *   npx hardhat run scripts/set-round-duration.ts --network sepolia
 *
 * 可选环境变量:
 *   ROUND_MINUTES=5    # 轮次时长（分钟），默认 5 分钟
 */

import { network } from "hardhat";
import fs from "fs";
import path from "path";

const { viem } = await network.connect();

async function main() {
  const publicClient = await viem.getPublicClient();
  const [owner] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  const minutes = Number(process.env.ROUND_MINUTES ?? "5");
  const newDuration = BigInt(minutes * 60); // seconds

  // 读取已部署地址
  const addressesPath = path.join(process.cwd(), "frontend/lib/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("addresses.json not found. Deploy first:\n  npx hardhat run scripts/deploy.ts --network sepolia");
  }
  const addrs = JSON.parse(fs.readFileSync(addressesPath, "utf-8"))[chainId.toString()];
  if (!addrs?.mmc) {
    throw new Error(`No deployment found for chainId ${chainId} in addresses.json`);
  }

  const mmc = await viem.getContractAt("MoneyMoneyCome", addrs.mmc);

  const current = await mmc.read.roundDuration();
  console.log(`MoneyMoneyCome : ${addrs.mmc}`);
  console.log(`Current duration : ${Number(current) / 60} minutes (${current}s)`);
  console.log(`Setting to       : ${minutes} minutes (${newDuration}s)...`);

  const tx = await mmc.write.setRoundDuration([newDuration], { account: owner.account });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const updated = await mmc.read.roundDuration();
  console.log(`✓ Done. New duration: ${Number(updated) / 60} minutes`);
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
