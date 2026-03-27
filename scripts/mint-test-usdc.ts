/**
 * 直接从 Aave 测试 USDC 合约铸造代币
 *
 * Aave 的 Sepolia 测试 USDC 是一个 MintableERC20，任何人都可以调用 mint()
 *
 * 用法:
 *   npx hardhat run scripts/mint-test-usdc.ts --network sepolia
 *
 * 可选:
 *   MINT_TO=0x...    目标地址（默认：部署者自己）
 *   MINT_AMOUNT=1000 铸造金额（USDC，默认 1000）
 */

import { network } from "hardhat";
import { parseUnits, formatUnits } from "viem";

const { viem } = await network.connect();

// Aave Sepolia 测试 USDC
const AAVE_TEST_USDC = "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8" as `0x${string}`;

// Aave 测试代币的 ABI（MintableERC20）
const MINTABLE_ERC20_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

async function main() {
  const publicClient = await viem.getPublicClient();
  const [wallet]     = await viem.getWalletClients();

  const recipient   = (process.env.MINT_TO ?? wallet.account.address) as `0x${string}`;
  const mintAmount  = process.env.MINT_AMOUNT ?? "1000";
  const amountRaw   = parseUnits(mintAmount, 6);

  console.log("━".repeat(50));
  console.log("  Mint Aave Test USDC");
  console.log("━".repeat(50));
  console.log(`  Token    : ${AAVE_TEST_USDC}`);
  console.log(`  To       : ${recipient}`);
  console.log(`  Amount   : ${mintAmount} USDC`);
  console.log();

  const balBefore = await publicClient.readContract({
    address: AAVE_TEST_USDC,
    abi: MINTABLE_ERC20_ABI,
    functionName: "balanceOf",
    args: [recipient],
  });
  console.log(`  Balance before: ${formatUnits(balBefore, 6)} USDC`);

  // 尝试调用 mint()
  const tx = await wallet.writeContract({
    address: AAVE_TEST_USDC,
    abi: MINTABLE_ERC20_ABI,
    functionName: "mint",
    args: [recipient, amountRaw],
    chain: wallet.chain,
    account: wallet.account,
  });

  console.log(`  Tx hash  : ${tx}`);
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const balAfter = await publicClient.readContract({
    address: AAVE_TEST_USDC,
    abi: MINTABLE_ERC20_ABI,
    functionName: "balanceOf",
    args: [recipient],
  });

  console.log(`  Balance after : ${formatUnits(balAfter, 6)} USDC`);
  console.log(`  ✓ Minted ${mintAmount} USDC successfully`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message ?? err);
  console.error("\n若 mint() 被拒绝，说明该测试 USDC 已限制铸造权限。");
  console.error("请改用 Circle USDC 并更新 deploy.ts 中的 USDC 地址。");
  process.exit(1);
});
