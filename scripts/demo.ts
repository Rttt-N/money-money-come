/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║       MoneyMoneyCome — Sepolia 真实网络演示脚本               ║
 * ║  连接已部署合约 → 参与游戏 → 触发开奖 → 等待 VRF → 显示结果    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 前置条件:
 *   1. 部署合约:  npx hardhat run scripts/deploy.ts --network sepolia
 *   2. 将 MoneyMoneyCome 地址添加为 VRF Consumer:
 *      https://vrf.chain.link/sepolia → 你的订阅 → Add Consumer
 *   3. 订阅中至少有 2 LINK
 *
 * .env 必填:
 *   SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
 *   SEPOLIA_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
 *   VRF_SUBSCRIPTION_ID=12345
 *
 * 可选:
 *   DEPOSIT_USDC=100   # 存入金额 (默认 100 USDC)
 *   TIER=3             # 参与等级 1/2/3 (默认 3, VIP)
 *   YIELD_USDC=50      # 手动注入额外利息 (默认 50 USDC)
 *
 * 用法:
 *   npx hardhat run scripts/demo.ts --network sepolia
 */

import { network } from "hardhat";
import fs from "fs";
import path from "path";

const { viem } = await network.connect();

// ── 工具函数 ─────────────────────────────────────────────────────────────────

const ONE_USDC = 1_000_000n; // 6 decimals

function fmt(raw: bigint): string {
  return `$${(Number(raw) / 1_000_000).toFixed(2)}`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function sep(char = "─", width = 62) {
  console.log(char.repeat(width));
}

function header(title: string) {
  sep("━");
  console.log(`  ${title}`);
  sep("━");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 读取已部署地址 ─────────────────────────────────────────────────────────

function loadAddresses(chainId: number) {
  const addressesPath = path.join(process.cwd(), "frontend/lib/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error(
      `addresses.json not found. Run deploy first:\n  npx hardhat run scripts/deploy.ts --network sepolia`
    );
  }
  const all = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
  const addrs = all[chainId.toString()];
  if (!addrs?.mmc) {
    throw new Error(
      `No deployment found in addresses.json (chainId ${chainId}).\n` +
        `Run: npx hardhat run scripts/deploy.ts --network sepolia`
    );
  }
  return addrs as {
    mmc: `0x${string}`;
    usdc: `0x${string}`;
    vault: `0x${string}`;
    squadRegistry: `0x${string}`;
    ticketNFT: `0x${string}`;
    mockAToken?: `0x${string}`;
  };
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  const publicClient = await viem.getPublicClient();
  const [player] = await viem.getWalletClients();

  const chainId = await publicClient.getChainId();
  if (chainId !== 11155111) {
    throw new Error(
      `Wrong network! Expected Sepolia (11155111), got ${chainId}.\n` +
        `Use: npx hardhat run scripts/demo.ts --network sepolia`
    );
  }

  const depositUsdc = BigInt(process.env.DEPOSIT_USDC ?? "100");
  const tier = Number(process.env.TIER ?? "3") as 1 | 2 | 3;
  if (tier < 1 || tier > 3) throw new Error("TIER must be 1, 2, or 3");

  // ── 1. 加载已部署合约 ────────────────────────────────────────────────────

  header("STEP 1 — Load Deployed Contracts");

  const addrs = loadAddresses(chainId);
  console.log(`  MoneyMoneyCome : ${addrs.mmc}`);
  console.log(`  MockUSDC       : ${addrs.usdc}`);
  console.log(`  YieldVault     : ${addrs.vault}`);
  console.log(`  SquadRegistry  : ${addrs.squadRegistry}`);
  console.log(`  TicketNFT      : ${addrs.ticketNFT}`);
  console.log();

  const mmc       = await viem.getContractAt("MoneyMoneyCome", addrs.mmc);
  const usdc      = await viem.getContractAt("MockUSDC",       addrs.usdc);
  const ticketNFT = await viem.getContractAt("TicketNFT",      addrs.ticketNFT);

  // ── 2. 账户状态检查 + 自动 Mint ────────────────────────────────────────────

  header("STEP 2 — Account Status & Auto-Mint");

  const playerAddr = player.account.address;
  const ethBalance = await publicClient.getBalance({ address: playerAddr });
  let usdcBalance = await usdc.read.balanceOf([playerAddr]);
  const depositRaw = depositUsdc * ONE_USDC;

  console.log(`  Player         : ${playerAddr}`);
  console.log(`  ETH balance    : ${(Number(ethBalance) / 1e18).toFixed(6)} ETH`);
  console.log(`  USDC balance   : ${fmt(usdcBalance)}`);
  console.log(`  Deposit amount : ${fmt(depositRaw)} (Tier ${tier})`);
  console.log();

  if (usdcBalance < depositRaw) {
    console.log(`  Insufficient USDC. Minting ${fmt(depositRaw)} MockUSDC...`);
    const mintTx = await usdc.write.mint(
      [playerAddr, depositRaw],
      { account: player.account }
    );
    await publicClient.waitForTransactionReceipt({ hash: mintTx });
    usdcBalance = await usdc.read.balanceOf([playerAddr]);
    console.log(`  ✓ Minted. New USDC balance: ${fmt(usdcBalance)}`);
    console.log();
  }

  // ── 3. 查看当前轮次 ──────────────────────────────────────────────────────

  header("STEP 3 — Current Round Info");

  const roundInfo = await mmc.read.getCurrentRoundInfo();
  const theRoundId = await mmc.read.currentRound();
  const stateNames = ["OPEN", "LOCKED", "DRAWING", "SETTLED"];
  const stateName = stateNames[roundInfo.state] ?? "UNKNOWN";

  console.log(`  Round ID       : #${theRoundId}`);
  console.log(`  State          : ${stateName}`);
  console.log(`  Total Principal: ${fmt(roundInfo.totalPrincipal)}`);
  console.log(`  Prize Pool     : ${fmt(roundInfo.prizePool)}`);
  const roundParticipants = await mmc.read.getRoundParticipants([theRoundId]);
  console.log(`  Participants   : ${roundParticipants.length}`);
  console.log();

  if (roundInfo.state !== 0) {
    console.log(`  ⚠  Round is not OPEN (state=${stateName}).`);
    console.log(`     Wait for the current round to settle and a new round to start.`);
    console.log(`     If stuck in DRAWING, wait for Chainlink VRF to fulfill (~1–3 min).`);
    process.exit(0);
  }

  // Check if round has already expired (can't enterGame, go straight to draw)
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const roundExpired = nowSec >= roundInfo.endTime;

  if (roundExpired) {
    console.log(`  ⚠  Round #${theRoundId} has already expired (endTime passed).`);
    console.log(`     Skipping enterGame — proceeding directly to draw.`);
    console.log(`     Participants already in round: ${roundParticipants.length}`);
    if (roundParticipants.length === 0) {
      console.log(`  ❌ No participants in expired round — cannot draw. Deploy a fresh contract.`);
      process.exit(1);
    }
    console.log();
  } else {
    // ── 4. Approve & Enter Game ────────────────────────────────────────────

    header("STEP 4 — Approve USDC & Enter Game");

    const tierLabels = ["", "Worker (retain 90%, weight 0.1×)", "Player (retain 50%, weight 0.5×)", "VIP (retain 0%, weight 1.0×)"];

    console.log(`  Approving ${fmt(depositRaw)} USDC for MoneyMoneyCome...`);
    const approveTx = await usdc.write.approve(
      [addrs.mmc, depositRaw],
      { account: player.account }
    );
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log(`  ✓ Approve confirmed: ${approveTx}`);

    console.log(`  Entering game — Tier ${tier}: ${tierLabels[tier]}...`);
    const enterTx = await mmc.write.enterGame(
      [depositRaw, tier, 0n],
      { account: player.account }
    );
    await publicClient.waitForTransactionReceipt({ hash: enterTx });
    console.log(`  ✓ enterGame confirmed: ${enterTx}`);

    const userInfo = await mmc.read.getUserInfo([playerAddr]);
    const nftBal   = await ticketNFT.read.balanceOf([playerAddr]);
    console.log();
    console.log(`  Principal in contract: ${fmt(userInfo.principal)}`);
    console.log(`  Weight (bps)         : ${userInfo.weightBps}`);
    console.log(`  NFT tickets          : ${nftBal}`);
    console.log();

    // ── 4b. 模拟 Aave 收益 ────────────────────────────────────────────────

    header("STEP 4b — Simulate Aave Yield");

    const yieldUsdc = BigInt(process.env.YIELD_USDC ?? "50");
    const yieldRaw = yieldUsdc * ONE_USDC;

    if (addrs.mockAToken) {
      const aToken = await viem.getContractAt("MockAToken", addrs.mockAToken);
      console.log(`  Simulating +${yieldUsdc} USDC yield to vault...`);
      const yieldTx = await aToken.write.simulateYield(
        [addrs.vault, yieldRaw],
        { account: player.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: yieldTx });
      console.log(`  ✓ Yield simulation confirmed: ${yieldTx}`);
    } else {
      console.log("  ⚠ mockAToken not found in addresses.json — skipping yield simulation");
      console.log("    (Auto-yield from yieldRateBps will still accrue over time)");
    }
    console.log();
  } // end if (!roundExpired)

  // ── 5. 等待轮次到期 ──────────────────────────────────────────────────────

  header("STEP 5 — Wait for Round Expiry");

  console.log(`  Polling checkUpkeep (round must expire + have participants)...`);

  let upkeepNeeded = false;
  let attempts = 0;
  while (!upkeepNeeded) {
    const result = await mmc.read.checkUpkeep(["0x"]);
    upkeepNeeded = result[0];
    if (!upkeepNeeded) {
      attempts++;
      if (attempts % 6 === 1) {
        process.stdout.write(`  Waiting for round to expire`);
      }
      process.stdout.write(".");
      await sleep(5_000);
    }
  }
  console.log();
  console.log(`  ✓ checkUpkeep returned true`);
  console.log();

  // ── 6. 触发 performUpkeep (OPEN → DRAWING) ──────────────────────────────

  header("STEP 6 — Trigger Draw (performUpkeep)");

  const upkeepTx = await mmc.write.performUpkeep(["0x"], { account: player.account });
  const upkeepReceipt = await publicClient.waitForTransactionReceipt({ hash: upkeepTx });
  console.log(`  ✓ performUpkeep confirmed: ${upkeepTx}`);

  // 从日志中获取 requestId
  const DRAW_ABI = [{
    type: "event",
    name: "DrawRequested",
    inputs: [
      { indexed: true,  name: "roundId",   type: "uint256" },
      { indexed: false, name: "requestId", type: "uint256" },
    ],
  }] as const;

  const drawEvents = await publicClient.getContractEvents({
    address: addrs.mmc,
    abi: DRAW_ABI,
    eventName: "DrawRequested",
    fromBlock: upkeepReceipt.blockNumber,
    toBlock: upkeepReceipt.blockNumber,
    strict: true,
  });

  if (drawEvents.length === 0) {
    throw new Error("DrawRequested event not found — performUpkeep may have failed");
  }

  const requestId = drawEvents[0].args.requestId;
  const currentRound = await mmc.read.getCurrentRoundInfo();
  console.log(`  VRF Request ID : ${requestId}`);
  console.log(`  Round state    : ${stateNames[currentRound.state]} (DRAWING)`);
  console.log(`  Prize Pool     : ${fmt(currentRound.prizePool)}`);
  console.log();

  // ── 7. 等待 Chainlink VRF fulfillRandomWords ─────────────────────────────

  header("STEP 7 — Waiting for Chainlink VRF Fulfillment (~1–3 min)");

  console.log(`  Chainlink VRF node is processing request ${requestId}...`);
  console.log(`  Polling round state every 10 seconds.`);
  console.log();

  const SETTLED_STATE = 3;
  let settled = false;
  let pollCount = 0;

  while (!settled) {
    await sleep(10_000);
    pollCount++;

    // Check the specific round we triggered the draw for
    const settledRound = await mmc.read.rounds([theRoundId]);
    const settledRoundState = Number(settledRound.state);

    // Check if current contract round has advanced past our round (means settlement happened)
    const liveRoundId = await mmc.read.currentRound();

    process.stdout.write(`  [${pollCount * 10}s] round #${theRoundId} state=${stateNames[settledRoundState] ?? settledRoundState}, currentRound=#${liveRoundId}`);

    if (settledRoundState === SETTLED_STATE) {
      console.log(` → SETTLED ✓`);
      settled = true;
      break;
    }

    // If the contract has moved to a new round, our round must have settled
    if (liveRoundId > theRoundId) {
      console.log(` → new round started, settlement detected ✓`);
      settled = true;
      break;
    }

    console.log();

    if (pollCount >= 60) {
      // 10 minutes max
      throw new Error(
        `VRF fulfillment timed out after 10 minutes.\n` +
          `Check your VRF subscription at https://vrf.chain.link/sepolia:\n` +
          `  - Is MoneyMoneyCome (${addrs.mmc}) listed as a consumer?\n` +
          `  - Does the subscription have enough LINK (min 0.5 LINK)?`
      );
    }
  }

  console.log(`  ✓ VRF fulfilled! Round #${theRoundId} settled.`);
  console.log();

  // ── 8. 结果展示 ──────────────────────────────────────────────────────────

  header("STEP 8 — Results");

  const settledRound = await mmc.read.rounds([theRoundId]);
  const winner = settledRound.winner;
  const prize  = settledRound.prizePool;
  const isWinner = playerAddr.toLowerCase() === winner.toLowerCase();

  console.log(`  Round #${theRoundId} Winner : ${shortAddr(winner)}${isWinner ? " ← YOU! 🏆" : ""}`);
  console.log(`  Prize Pool      : ${fmt(prize)}`);
  console.log();

  sep();
  console.log("  Your Final State");
  sep();

  const finalUsdc    = await usdc.read.balanceOf([playerAddr]);
  const finalInfo    = await mmc.read.getUserInfo([playerAddr]);
  const finalNft     = await ticketNFT.read.balanceOf([playerAddr]);

  console.log(`  ${isWinner ? "🏆" : "  "} USDC wallet            : ${fmt(finalUsdc)}`);
  console.log(`     Principal in contract: ${fmt(finalInfo.principal)}`);
  console.log(`     NFT tickets          : ${finalNft}`);
  console.log(`     Loyalty rounds       : ${finalInfo.loyaltyRounds}`);
  console.log();

  const newRound = await mmc.read.getCurrentRoundInfo();
  sep("━");
  console.log(`  Round #${newRound.roundId} started automatically (state: OPEN)`);
  console.log(`  Your principal has been rolled over into the new round ✓`);
  sep("━");
  console.log();
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message ?? err);
  process.exit(1);
});
