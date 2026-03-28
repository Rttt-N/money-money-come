/**
 * 紧急重置卡死的轮次（onlyOwner）
 * 适用场景：VRF 回调失败，轮次卡在 DRAWING 或 LOCKED 状态。
 *
 * 效果：
 *   - 强制将当前轮次标记为 SETTLED（无赢家）
 *   - 自动开启新一轮（OPEN），参与者 principal 自动 rollover
 *
 * 用法:
 *   npx hardhat run scripts/emergency-reset.ts --network sepolia
 */

import { network } from "hardhat";
import fs from "fs";
import path from "path";

const { viem } = await network.connect();

async function main() {
  const publicClient = await viem.getPublicClient();
  const [owner] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  const addressesPath = path.join(process.cwd(), "frontend/lib/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("addresses.json not found. Deploy first.");
  }
  const addrs = JSON.parse(fs.readFileSync(addressesPath, "utf-8"))[chainId.toString()];
  if (!addrs?.mmc) throw new Error(`No deployment for chainId ${chainId}`);

  const mmc = await viem.getContractAt("MoneyMoneyCome", addrs.mmc);
  const stateNames = ["OPEN", "LOCKED", "DRAWING", "SETTLED"];

  const roundId   = await mmc.read.currentRound();
  const roundInfo = await mmc.read.getCurrentRoundInfo();
  const stateName = stateNames[roundInfo.state] ?? String(roundInfo.state);

  console.log(`MoneyMoneyCome : ${addrs.mmc}`);
  console.log(`Current round  : #${roundId}  state=${stateName}`);

  if (roundInfo.state === 0) {
    console.log("Round is OPEN — no reset needed.");
    return;
  }
  if (roundInfo.state === 3) {
    console.log("Round already SETTLED — new round should have started automatically.");
    return;
  }

  console.log(`Calling emergencyReset() to force-settle round #${roundId}...`);
  const tx = await mmc.write.emergencyReset({ account: owner.account });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const newRoundId   = await mmc.read.currentRound();
  const newRoundInfo = await mmc.read.getCurrentRoundInfo();
  console.log(`✓ Done!`);
  console.log(`  Old round #${roundId} → SETTLED (no winner)`);
  console.log(`  New round #${newRoundId} → ${stateNames[newRoundInfo.state]}`);
  console.log(`  Participants rolled over automatically.`);
  console.log();
  console.log(`Next step: npx hardhat run scripts/demo.ts --network sepolia`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message ?? err);
  process.exit(1);
});
