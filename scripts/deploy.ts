/**
 * 统一部署脚本：自动识别网络，本地和 Sepolia 均使用 MockUSDC + MockAave。
 * Sepolia 使用真实 Chainlink VRF，本地使用 MockVRFCoordinator。
 *
 * 本地:
 *   npx hardhat run scripts/deploy.ts --network hardhatMainnet
 *
 * Sepolia (需要 .env):
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *   必填环境变量:
 *     SEPOLIA_RPC_URL=https://...
 *     SEPOLIA_PRIVATE_KEY=0x...
 *     VRF_SUBSCRIPTION_ID=12345        # Chainlink VRF 订阅 ID
 *
 * Sepolia 准备工作:
 *   1. 前往 https://vrf.chain.link/sepolia 创建 VRF V2.5 订阅
 *   2. 用 LINK 充值订阅 (至少 2 LINK)
 *   3. 部署合约后，将 MoneyMoneyCome 地址添加为 Consumer
 */

import { network } from "hardhat";
import fs from "fs";
import path from "path";

const { viem } = await network.connect();

// ── Sepolia 真实 VRF 地址 ──────────────────────────────────────────────────────
// 来源: https://docs.chain.link/vrf/v2-5/supported-networks#sepolia-testnet
const SEPOLIA_VRF = {
  vrfCoord:   "0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B" as `0x${string}`,
  vrfKeyHash: "0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae" as `0x${string}`,
} as const;

async function main() {
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  console.log("━".repeat(60));
  console.log("  MoneyMoneyCome Deploy");
  console.log(`  Chain ID : ${chainId}`);
  console.log(`  Deployer : ${deployer.account.address}`);
  console.log("━".repeat(60));

  const isLocal   = chainId === 31337;
  const isSepolia = chainId === 11155111;

  if (!isLocal && !isSepolia) {
    throw new Error(`Unsupported chainId: ${chainId}. Use hardhatMainnet (31337) or sepolia (11155111).`);
  }

  // ── Step 1: 部署 MockUSDC + MockAave（所有网络共用）──────────────────────────

  console.log("\n[Mocks] Deploying MockUSDC + MockAavePool...");

  const mockUSDC = await viem.deployContract("MockUSDC");
  console.log("  MockUSDC           :", mockUSDC.address);

  const mockAavePool = await viem.deployContract("MockAavePool", [mockUSDC.address]);
  console.log("  MockAavePool       :", mockAavePool.address);

  const aTokenAddress = await mockAavePool.read.aToken();
  console.log("  MockAToken         :", aTokenAddress);

  const usdcAddress  = mockUSDC.address;
  const aavePoolAddr = mockAavePool.address;

  // 设置 demo 利率: 200 bps/min = 2%/min，5 分钟约 10% yield
  const aToken = await viem.getContractAt("MockAToken", aTokenAddress);
  await aToken.write.setYieldRate([200n]);
  console.log("  MockAToken yieldRate: 200 bps/min (2%/min) ✓");

  // ── Step 2: VRF（本地 vs Sepolia）──────────────────────────────────────────

  let vrfCoordAddr: `0x${string}`;
  let vrfKeyHash:   `0x${string}`;
  let vrfSubId:     bigint;

  if (isLocal) {
    console.log("\n[Local] Deploying MockVRFCoordinator...");
    const mockVRF = await viem.deployContract("MockVRFCoordinator");
    console.log("  MockVRFCoordinator :", mockVRF.address);

    vrfCoordAddr = mockVRF.address;
    vrfKeyHash   = "0x0000000000000000000000000000000000000000000000000000000000000000";
    vrfSubId     = 1n;
  } else {
    // Sepolia — 使用真实 Chainlink VRF
    console.log("\n[Sepolia] Using real Chainlink VRF...");

    const subIdStr = process.env.VRF_SUBSCRIPTION_ID;
    if (!subIdStr) {
      throw new Error(
        "VRF_SUBSCRIPTION_ID env var is required for Sepolia.\n" +
        "Create a subscription at https://vrf.chain.link/sepolia and set VRF_SUBSCRIPTION_ID=<id>"
      );
    }

    vrfCoordAddr = SEPOLIA_VRF.vrfCoord;
    vrfKeyHash   = SEPOLIA_VRF.vrfKeyHash;
    vrfSubId     = BigInt(subIdStr);

    console.log("  VRF Coordinator    :", vrfCoordAddr);
    console.log("  VRF Subscription   :", vrfSubId.toString());
  }

  // ── Step 3: 部署核心合约 ─────────────────────────────────────────────────────

  console.log("\n[Core] Deploying protocol contracts...");

  const vault = await viem.deployContract("YieldVault", [
    usdcAddress,
    aavePoolAddr,
    aTokenAddress,
    deployer.account.address,
  ]);
  console.log("  YieldVault         :", vault.address);

  const squadRegistry = await viem.deployContract("SquadRegistry", [
    deployer.account.address,
  ]);
  console.log("  SquadRegistry      :", squadRegistry.address);

  const ticketNFT = await viem.deployContract("TicketNFT", [
    deployer.account.address,
  ]);
  console.log("  TicketNFT          :", ticketNFT.address);

  const mmc = await viem.deployContract("MoneyMoneyCome", [
    usdcAddress,
    vault.address,
    ticketNFT.address,
    squadRegistry.address,
    vrfCoordAddr,
    vrfKeyHash,
    vrfSubId,
    deployer.account.address,
  ]);
  console.log("  MoneyMoneyCome     :", mmc.address);

  // ── Step 4: 转移所有权 + 设置轮次 ──────────────────────────────────────────

  await vault.write.transferOwnership([mmc.address]);
  await ticketNFT.write.transferOwnership([mmc.address]);
  console.log("\n[Setup] Ownership transferred to MoneyMoneyCome ✓");

  await mmc.write.setRoundDuration([300n]); // 5 minutes for testing
  console.log("[Setup] Round duration set to 300s (5 min) ✓");

  // ── Step 5: 写入 addresses.json ──────────────────────────────────────────────

  const chainKey = chainId.toString();
  const addressesPath = path.join(process.cwd(), "frontend/lib/addresses.json");

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(addressesPath)) {
    existing = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
  }

  existing[chainKey] = {
    mmc:           mmc.address,
    usdc:          usdcAddress,
    vault:         vault.address,
    squadRegistry: squadRegistry.address,
    ticketNFT:     ticketNFT.address,
    mockAToken:    aTokenAddress,
    ...(isLocal ? { mockVRF: vrfCoordAddr } : {}),
  };

  fs.writeFileSync(addressesPath, JSON.stringify(existing, null, 2));
  console.log(`[Done] Addresses written to frontend/lib/addresses.json (chainId: ${chainKey})`);

  // ── 部署后提示 ──────────────────────────────────────────────────────────────

  if (isSepolia) {
    console.log("\n" + "━".repeat(60));
    console.log("  Post-deployment checklist (Sepolia):");
    console.log("  1. Add MoneyMoneyCome as VRF consumer:");
    console.log(`       https://vrf.chain.link/sepolia → subscription ${vrfSubId}`);
    console.log(`       Consumer address: ${mmc.address}`);
    console.log("  2. Mint test USDC:");
    console.log("       npx hardhat run scripts/mint-usdc.ts --network sepolia");
    console.log("  3. (Optional) Add MockUSDC to MetaMask:");
    console.log(`       Import Token → ${usdcAddress}`);
    console.log("  4. Run demo:");
    console.log("       npx hardhat run scripts/demo.ts --network sepolia");
    console.log("━".repeat(60));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
