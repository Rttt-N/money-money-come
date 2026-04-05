/**
 * 绑定 Chainlink Automation Forwarder 地址到 MoneyMoneyCome 合约（onlyOwner）
 *
 * 在 automation.chain.link/sepolia 注册 Upkeep 后执行此脚本。
 * 绑定后，只有 Chainlink Automation 节点（通过 Forwarder）和 owner 可以调用 performUpkeep。
 *
 * 获取 Forwarder 地址的方式：
 *   方式一（自动）：提供 UPKEEP_ID，脚本自动从 Registry 读取
 *   方式二（手动）：在 automation.chain.link 页面找到 Upkeep → 复制 Forwarder address
 *
 * 用法:
 *   # 自动获取 Forwarder（推荐）
 *   UPKEEP_ID=12345 npx hardhat run scripts/set-automation-forwarder.ts --network sepolia
 *
 *   # 手动指定 Forwarder 地址
 *   FORWARDER=0x你的Forwarder地址 npx hardhat run scripts/set-automation-forwarder.ts --network sepolia
 *
 *   # 清除绑定（恢复任何人都可以调用的模式）
 *   FORWARDER=0x0000000000000000000000000000000000000000 npx hardhat run scripts/set-automation-forwarder.ts --network sepolia
 */

import { network } from "hardhat";
import fs from "fs";
import path from "path";

const { viem } = await network.connect();

// Chainlink Automation Registry v2.3 on Sepolia
const AUTOMATION_REGISTRY_SEPOLIA = "0x86EFBD0b6736Bed994962f9797049422A3A8E8Ad";

const REGISTRY_ABI = [
  {
    type: "function",
    name: "getForwarder",
    inputs: [{ name: "upkeepID", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

async function main() {
  const publicClient = await viem.getPublicClient();
  const [owner] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  if (chainId !== 11155111) {
    throw new Error(`Expected Sepolia (11155111), got ${chainId}`);
  }

  const addressesPath = path.join(process.cwd(), "frontend/lib/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("addresses.json not found. Deploy first.");
  }
  const addrs = JSON.parse(fs.readFileSync(addressesPath, "utf-8"))[chainId.toString()];
  if (!addrs?.mmc) throw new Error(`No deployment for chainId ${chainId}`);

  const mmc = await viem.getContractAt("MoneyMoneyCome", addrs.mmc);

  let forwarderAddress: `0x${string}`;

  if (process.env.FORWARDER) {
    // Manual mode: use provided address
    forwarderAddress = process.env.FORWARDER as `0x${string}`;
    console.log(`Using provided forwarder address: ${forwarderAddress}`);
  } else if (process.env.UPKEEP_ID) {
    // Auto mode: query Registry for forwarder
    const upkeepId = BigInt(process.env.UPKEEP_ID);
    console.log(`Querying Automation Registry for Upkeep #${upkeepId}...`);
    const registry = await viem.getContractAt(
      "MoneyMoneyCome", // dummy — use raw ABI via publicClient
      AUTOMATION_REGISTRY_SEPOLIA
    );
    forwarderAddress = await publicClient.readContract({
      address: AUTOMATION_REGISTRY_SEPOLIA as `0x${string}`,
      abi: REGISTRY_ABI,
      functionName: "getForwarder",
      args: [upkeepId],
    });
    console.log(`  Forwarder address: ${forwarderAddress}`);
  } else {
    throw new Error(
      "Provide UPKEEP_ID or FORWARDER environment variable.\n" +
      "  UPKEEP_ID=12345 npx hardhat run scripts/set-automation-forwarder.ts --network sepolia\n" +
      "  FORWARDER=0x... npx hardhat run scripts/set-automation-forwarder.ts --network sepolia"
    );
  }

  const current = await mmc.read.automationForwarder();
  console.log(`MoneyMoneyCome       : ${addrs.mmc}`);
  console.log(`Current forwarder    : ${current === "0x0000000000000000000000000000000000000000" ? "(not set — open mode)" : current}`);
  console.log(`Setting forwarder to : ${forwarderAddress === "0x0000000000000000000000000000000000000000" ? "(clearing — open mode)" : forwarderAddress}...`);

  const tx = await mmc.write.setAutomationForwarder(
    [forwarderAddress],
    { account: owner.account }
  );
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const updated = await mmc.read.automationForwarder();
  const isOpen = updated === "0x0000000000000000000000000000000000000000";
  console.log(`✓ Done.`);
  if (isOpen) {
    console.log(`  Mode: OPEN — anyone can call performUpkeep (manual/demo mode)`);
  } else {
    console.log(`  Mode: RESTRICTED — only Chainlink Automation forwarder or owner`);
    console.log(`  Forwarder: ${updated}`);
  }
}

main().catch((err) => {
  console.error("❌ Error:", err.message ?? err);
  process.exit(1);
});
