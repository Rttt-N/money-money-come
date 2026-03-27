/**
 * 统一部署脚本：自动识别网络，本地使用 Mock，Sepolia 使用真实合约。
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
 *   4. 前往 https://faucets.chain.link/sepolia-aave 获取测试 USDC
 */

import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { viem } = await network.connect();

// ── Sepolia 真实合约地址 ──────────────────────────────────────────────────────
// 来源: https://docs.aave.com/developers/deployed-contracts/v3-testnet-addresses
//       https://docs.chain.link/vrf/v2-5/supported-networks#sepolia-testnet
const SEPOLIA = {
  // Aave V3 Pool (Sepolia)
  aavePool:   "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951" as `0x${string}`,
  // Aave 测试 USDC (从 https://faucets.chain.link/sepolia-aave 获取)
  usdc:       "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8" as `0x${string}`,
  // aUSDC token on Aave V3 Sepolia
  aToken:     "0x16dA4541aD1807f4443d92D26044C1147406EB80" as `0x${string}`,
  // Chainlink VRF V2.5 Coordinator (Sepolia)
  vrfCoord:   "0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B" as `0x${string}`,
  // VRF Key Hash (750 gwei lane, Sepolia)
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

  // ── Step 1: 底层依赖 (USDC / Aave / VRF) ────────────────────────────────────

  let usdcAddress:    `0x${string}`;
  let aavePoolAddr:   `0x${string}`;
  let aTokenAddress:  `0x${string}`;
  let vrfCoordAddr:   `0x${string}`;
  let vrfKeyHash:     `0x${string}`;
  let vrfSubId:       bigint;

  if (isLocal) {
    console.log("\n[Local] Deploying mock contracts...");

    const mockUSDC = await viem.deployContract("MockUSDC");
    console.log("  MockUSDC           :", mockUSDC.address);

    const mockAavePool = await viem.deployContract("MockAavePool", [mockUSDC.address]);
    console.log("  MockAavePool       :", mockAavePool.address);

    aTokenAddress = await mockAavePool.read.aToken();
    console.log("  MockAToken         :", aTokenAddress);

    const mockVRF = await viem.deployContract("MockVRFCoordinator");
    console.log("  MockVRFCoordinator :", mockVRF.address);

    await mockVRF.write.createSubscription();
    const [localSubId] = await mockVRF.read.getActiveSubscriptionIds([0n, 1n]);
    if (localSubId === undefined) {
      throw new Error("Failed to create local VRF subscription");
    }
    await mockVRF.write.fundSubscription([localSubId, 1000000000000000000n]);
    console.log("  Mock VRF Sub ID    :", localSubId.toString());

    usdcAddress  = mockUSDC.address;
    aavePoolAddr = mockAavePool.address;
    vrfCoordAddr = mockVRF.address;
    vrfKeyHash   = "0x0000000000000000000000000000000000000000000000000000000000000000";
    vrfSubId     = localSubId;

  } else {
    // Sepolia — 使用真实合约
    console.log("\n[Sepolia] Using real contract addresses...");

    const subIdStr = process.env.VRF_SUBSCRIPTION_ID;
    if (!subIdStr) {
      throw new Error(
        "VRF_SUBSCRIPTION_ID env var is required for Sepolia.\n" +
        "Create a subscription at https://vrf.chain.link/sepolia and set VRF_SUBSCRIPTION_ID=<id>"
      );
    }

    usdcAddress  = SEPOLIA.usdc;
    aavePoolAddr = SEPOLIA.aavePool;
    aTokenAddress = SEPOLIA.aToken;
    vrfCoordAddr = SEPOLIA.vrfCoord;
    vrfKeyHash   = SEPOLIA.vrfKeyHash;
    vrfSubId     = BigInt(subIdStr);

    console.log("  USDC (Aave faucet) :", usdcAddress);
    console.log("  Aave V3 Pool       :", aavePoolAddr);
    console.log("  aUSDC              :", aTokenAddress);
    console.log("  VRF Coordinator    :", vrfCoordAddr);
    console.log("  VRF Subscription   :", vrfSubId.toString());
  }

  // ── Step 2: 部署核心合约 ─────────────────────────────────────────────────────

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

  if (isLocal) {
    const mockVRF = await viem.getContractAt("MockVRFCoordinator", vrfCoordAddr);
    await mockVRF.write.addConsumer([vrfSubId, mmc.address]);
    console.log("  VRF Consumer Added :", mmc.address);
  }

  // ── Step 3: 转移所有权 ───────────────────────────────────────────────────────

  await vault.write.transferOwnership([mmc.address]);
  await ticketNFT.write.transferOwnership([mmc.address]);
  console.log("\n[Setup] Ownership transferred to MoneyMoneyCome ✓");

  if (isLocal) {
    await mmc.write.setRoundDuration([300n]); // 5 minutes for local testing
    console.log("[Setup] Round duration set to 300s (5 min) for local testing ✓");
  }

  // ── Step 4: 写入 addresses.json ──────────────────────────────────────────────

  const chainKey = chainId.toString();
  const addressesPath = path.join(__dirname, "../frontend/lib/addresses.json");

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
    ...(isLocal ? { mockVRF: vrfCoordAddr } : {}),
  };

  fs.writeFileSync(addressesPath, JSON.stringify(existing, null, 2));
  console.log(`[Done] Addresses written to frontend/lib/addresses.json (chainId: ${chainKey})`);

  if (isSepolia) {
    console.log("\n" + "━".repeat(60));
    console.log("  Post-deployment checklist (Sepolia):");
    console.log("  1. Add MoneyMoneyCome as VRF consumer:");
    console.log(`       https://vrf.chain.link/sepolia → subscription ${vrfSubId}`);
    console.log(`       Consumer address: ${mmc.address}`);
    console.log("  2. Get test USDC from Aave faucet:");
    console.log("       https://faucets.chain.link/sepolia-aave");
    console.log("  3. Approve + call enterGame() via the frontend.");
    console.log("━".repeat(60));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
