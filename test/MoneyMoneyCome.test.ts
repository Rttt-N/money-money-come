import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

// ── Constants ──────────────────────────────────────────────────────────────────
const ONE_USDC = 10n ** 6n; // 1 USDC = 1_000_000 (6 decimals)
const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

describe("MoneyMoneyCome", async function () {
  const { viem, provider } = await network.connect();

  // ── 部署所有合约 ──────────────────────────────────────────────────────────
  async function deployAll() {
    const [owner, user1, user2, user3] = await viem.getWalletClients();

    // 1. Mock 合约
    const mockUSDC = await viem.deployContract("MockUSDC");
    const mockAavePool = await viem.deployContract("MockAavePool", [mockUSDC.address]);
    const mockVRF = await viem.deployContract("MockVRFCoordinator");

    // 2. MockAToken（由 MockAavePool 在构造函数中部署）
    const aTokenAddress = await mockAavePool.read.aToken();
    const mockAToken = await viem.getContractAt("MockAToken", aTokenAddress);

    // 3. 核心合约
    const vault = await viem.deployContract("YieldVault", [
      mockUSDC.address,
      mockAavePool.address,
      aTokenAddress,
      owner.account.address,
    ]);
    const squadRegistry = await viem.deployContract("SquadRegistry", [
      owner.account.address,
    ]);
    const ticketNFT = await viem.deployContract("TicketNFT", [owner.account.address]);

    // 4. 主合约
    const mmc = await viem.deployContract("MoneyMoneyCome", [
      mockUSDC.address,
      vault.address,
      ticketNFT.address,
      squadRegistry.address,
      mockVRF.address,
      BYTES32_ZERO,
      1n, // subscriptionId
      owner.account.address,
    ]);

    // 5. ⚠️ 必须将 YieldVault 和 TicketNFT 的所有权转给主合约
    //    否则主合约调用 vault.deposit/redeem 和 ticketNFT.mint/burn 时会 revert
    await vault.write.transferOwnership([mmc.address]);
    await ticketNFT.write.transferOwnership([mmc.address]);

    return {
      mmc,
      vault,
      ticketNFT,
      squadRegistry,
      mockUSDC,
      mockAavePool,
      mockVRF,
      mockAToken,
      owner,
      user1,
      user2,
      user3,
    };
  }

  type Ctx = Awaited<ReturnType<typeof deployAll>>;
  type WalletClient = Ctx["user1"];

  // ── 辅助：铸造 USDC + 授权 + 调用 enterGame ───────────────────────────────
  async function enterGame(
    ctx: Ctx,
    user: WalletClient,
    amount: bigint,
    tier: number,
    squadId = 0n,
  ) {
    await ctx.mockUSDC.write.mint([user.account.address, amount]);
    await ctx.mockUSDC.write.approve([ctx.mmc.address, amount], {
      account: user.account,
    });
    await ctx.mmc.write.enterGame([amount, tier, squadId], {
      account: user.account,
    });
  }

  // ── 辅助：模拟 Aave 利息 ──────────────────────────────────────────────────
  //   同时给 MockAavePool 充值等额 USDC，确保取款时池子有足够余额
  async function simulateYield(ctx: Ctx, amount: bigint) {
    await ctx.mockAToken.write.simulateYield([ctx.vault.address, amount]);
    await ctx.mockUSDC.write.mint([ctx.mockAavePool.address, amount]);
  }

  // ── 辅助：快进 EVM 时间 ────────────────────────────────────────────────────
  async function increaseTime(seconds: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (provider as any).request({
      method: "evm_increaseTime",
      params: [seconds],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (provider as any).request({ method: "evm_mine", params: [] });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 1. Deployment — 基础部署检查
  // ════════════════════════════════════════════════════════════════════════
  describe("Deployment", async function () {
    it("should start at round 1 in OPEN state", async function () {
      const ctx = await deployAll();

      const round = await ctx.mmc.read.currentRound();
      assert.equal(round, 1n);

      const info = await ctx.mmc.read.getCurrentRoundInfo();
      assert.equal(info.state, 0); // RoundState.OPEN = 0
    });

    it("YieldVault and TicketNFT owner should be the main contract", async function () {
      const ctx = await deployAll();

      const vaultOwner = await ctx.vault.read.owner();
      const nftOwner = await ctx.ticketNFT.read.owner();

      assert.equal(vaultOwner.toLowerCase(), ctx.mmc.address.toLowerCase());
      assert.equal(nftOwner.toLowerCase(), ctx.mmc.address.toLowerCase());
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. enterGame — 存款逻辑
  // ════════════════════════════════════════════════════════════════════════
  describe("enterGame", async function () {
    it("should update user principal and tier amounts correctly", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 2);

      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, amount);
      assert.equal(info.tier1Amount, 0n);
      assert.equal(info.tier2Amount, amount);
      assert.equal(info.tier3Amount, 0n);
    });

    it("should mint an NFT ticket on deposit", async function () {
      const ctx = await deployAll();
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 1);

      const balance = await ctx.ticketNFT.read.balanceOf([
        ctx.user1.account.address,
      ]);
      assert.equal(balance, 1n);
    });

    it("Tier 1 weight = 10% of deposit, Tier 3 weight = 100% of deposit", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;

      // Tier 1: weightMultiplierBps = 1000 → weight = 100 * 10% = 10 USDC
      await enterGame(ctx, ctx.user1, amount, 1);
      const u1 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(u1.weightBps, 10n * ONE_USDC);

      // Tier 3: weightMultiplierBps = 10000 → weight = 100 * 100% = 100 USDC
      await enterGame(ctx, ctx.user2, amount, 3);
      const u2 = await ctx.mmc.read.getUserInfo([ctx.user2.account.address]);
      assert.equal(u2.weightBps, 100n * ONE_USDC);
    });

    it("should revert if deposit is below minimum (10 USDC)", async function () {
      const ctx = await deployAll();
      const tooLittle = 5n * ONE_USDC; // 5 USDC < 10 USDC min
      await ctx.mockUSDC.write.mint([ctx.user1.account.address, tooLittle]);
      await ctx.mockUSDC.write.approve([ctx.mmc.address, tooLittle], {
        account: ctx.user1.account,
      });

      await assert.rejects(async () => {
        await ctx.mmc.write.enterGame([tooLittle, 1, 0n], {
          account: ctx.user1.account,
        });
      });
    });

    it("should allow top-up deposit in same round (blended per-tier amounts)", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 1);

      // Top up with another 100 USDC at Tier 2 (each deposit keeps its own tier)
      await enterGame(ctx, ctx.user1, amount, 2);

      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, 200n * ONE_USDC);
      assert.equal(info.tier1Amount, 100n * ONE_USDC);
      assert.equal(info.tier2Amount, 100n * ONE_USDC);
      assert.equal(info.tier3Amount, 0n);

      // Blended weight: (100*1000 + 100*5000) / 10000 = 60 USDC
      assert.equal(info.weightBps, 60n * ONE_USDC);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. withdraw — 取款逻辑
  // ════════════════════════════════════════════════════════════════════════
  describe("withdraw", async function () {
    it("should return full principal to user (no yield, no penalty)", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 2);

      const before = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);
      await ctx.mmc.write.withdraw([amount], { account: ctx.user1.account });
      const after = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);

      assert.equal(after - before, amount);
    });

    it("should burn NFT ticket on full withdrawal", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 1);

      await ctx.mmc.write.withdraw([amount], { account: ctx.user1.account });

      const balance = await ctx.ticketNFT.read.balanceOf([
        ctx.user1.account.address,
      ]);
      assert.equal(balance, 0n);
    });

    it("should revert if user has no deposit", async function () {
      const ctx = await deployAll();

      await assert.rejects(async () => {
        await ctx.mmc.write.withdraw([100n * ONE_USDC], {
          account: ctx.user1.account,
        });
      });
    });

    it("should allow two half withdrawals of full deposit (200 → 100 → 100)", async function () {
      const ctx = await deployAll();
      const deposit = 200n * ONE_USDC;
      const half = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, deposit, 2);

      const before = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);
      await ctx.mmc.write.withdraw([half], { account: ctx.user1.account });
      await ctx.mmc.write.withdraw([half], { account: ctx.user1.account });
      const after = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);

      assert.equal(after - before, deposit);
    });

    // 回归：非对称部分取款（与组员复现场景一致）
    it("should allow uneven partial withdrawals (5002 → 3000 → 2002)", async function () {
      const ctx = await deployAll();
      const deposit = 5002n * ONE_USDC;
      const first = 3000n * ONE_USDC;
      const rest = 2002n * ONE_USDC;
      await enterGame(ctx, ctx.user1, deposit, 2);

      const before = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);
      await ctx.mmc.write.withdraw([first], { account: ctx.user1.account });
      await ctx.mmc.write.withdraw([rest], { account: ctx.user1.account });
      const after = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);

      assert.equal(after - before, deposit);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. Full Round — 完整开奖流程（最核心的测试）
  //    存款 → 模拟利息 → 时间快进 → performUpkeep → VRF回调 → winner收款 → 新轮开始
  // ════════════════════════════════════════════════════════════════════════
  describe("Full Round", async function () {
    it("should complete a full round and pay winner the prize", async function () {
      const ctx = await deployAll();
      const amount = 200n * ONE_USDC;
      const yieldAmount = 20n * ONE_USDC;

      // user1 以 Tier 3 存入（所有利息贡献给奖池，获得最高权重）
      await enterGame(ctx, ctx.user1, amount, 3);

      // 模拟 Aave 利息：+20 USDC 进奖池
      await simulateYield(ctx, yieldAmount);

      // ROUND_DURATION = 1 秒，快进 2 秒确保时间超过
      await increaseTime(2);

      // checkUpkeep 应返回 true（时间已到 + 有参与者）
      const [upkeepNeeded] = await ctx.mmc.read.checkUpkeep(["0x"]);
      assert.equal(upkeepNeeded, true);

      // performUpkeep：harvest yield + 进入 DRAWING 状态 + 请求 VRF（requestId = 1）
      await ctx.mmc.write.performUpkeep(["0x"]);

      // 记录 winner 当前余额（存款后为 0）
      const balanceBefore = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);

      // MockVRF 回调（user1 是唯一参与者，任何随机数都赢）
      await ctx.mockVRF.write.fulfillRequest([1n, 42n]);

      const balanceAfter = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);

      // ✅ user1（Tier 3，无 squad）应收到全部 prizePool
      assert.ok(
        balanceAfter > balanceBefore,
        "Winner should receive the prize",
      );

      // ✅ 新一轮已自动开始（currentRound 从 1 变为 2）
      const newRound = await ctx.mmc.read.currentRound();
      assert.equal(newRound, 2n);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4b. Rollover — 跨轮连续参与
  //     存款 → 完成一轮 → 验证自动加入下一轮（无需重新存款）
  // ════════════════════════════════════════════════════════════════════════
  describe("Rollover", async function () {
    it("should auto-enroll user into next round after settlement", async function () {
      const ctx = await deployAll();
      const amount = 200n * ONE_USDC;
      const yieldAmount = 20n * ONE_USDC;

      // Round 1: user1 deposits as Tier 3
      await enterGame(ctx, ctx.user1, amount, 3);

      // Complete round 1
      await simulateYield(ctx, yieldAmount);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 42n]);

      // Verify new round started
      const newRound = await ctx.mmc.read.currentRound();
      assert.equal(newRound, 2n);

      // Verify user is auto-enrolled in round 2
      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, amount); // Principal preserved
      assert.equal(info.roundJoined, 2n);   // Rolled into round 2
      assert.equal(info.loyaltyRounds, 1n); // Loyalty incremented

      // Verify round 2 has the user's principal and weight
      const roundInfo = await ctx.mmc.read.getCurrentRoundInfo();
      assert.equal(roundInfo.totalPrincipal, amount);
      assert.ok(roundInfo.totalWeight > 0n);

      // Verify participants list includes the user
      const participants = await ctx.mmc.read.getRoundParticipants([2n]);
      assert.equal(participants.length, 1);
      assert.equal(
        participants[0].toLowerCase(),
        ctx.user1.account.address.toLowerCase(),
      );
    });

    it("should give loyalty bonus weight after rollover", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;

      // Round 1: Tier 3, base weight = 100 USDC, loyalty mult = 1.0
      await enterGame(ctx, ctx.user1, amount, 3);
      const infoR1 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR1.weightBps, 100n * ONE_USDC); // 100 * 1.0 * 1.0

      // Complete round 1
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 0n]);

      // Round 2: loyalty = 1 → mult = 1.05, weight = 100 * 1.0 * 1.05 = 105
      const infoR2 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR2.loyaltyRounds, 1n);
      assert.equal(infoR2.weightBps, 105n * ONE_USDC);
    });

    it("should preserve blended tier amounts through rollover", async function () {
      const ctx = await deployAll();

      // Round 1: 60 USDC at Tier 1 + 40 USDC at Tier 3
      await enterGame(ctx, ctx.user1, 60n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user1, 40n * ONE_USDC, 3);

      const infoR1 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR1.tier1Amount, 60n * ONE_USDC);
      assert.equal(infoR1.tier3Amount, 40n * ONE_USDC);
      // Blended weight: (60*1000 + 40*10000) / 10000 = 46 USDC
      assert.equal(infoR1.weightBps, 46n * ONE_USDC);

      // Complete round 1
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 42n]);

      // Round 2: tier amounts preserved, weight recalculated with loyalty
      const infoR2 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR2.tier1Amount, 60n * ONE_USDC);
      assert.equal(infoR2.tier3Amount, 40n * ONE_USDC);
      assert.equal(infoR2.principal, 100n * ONE_USDC);
      assert.equal(infoR2.loyaltyRounds, 1n);
      // Weight with loyalty: 46 * 1.05 = 48.3 USDC
      assert.equal(infoR2.weightBps, 48300000n); // 48.3 * 1e6
    });

    it("should accumulate loyalty across multiple rounds (round 1 → 2 → 3)", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;

      // Round 1
      await enterGame(ctx, ctx.user1, amount, 3);

      // Complete round 1
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 0n]);

      // Round 2: loyalty = 1
      const infoR2 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR2.loyaltyRounds, 1n);
      assert.equal(infoR2.weightBps, 105n * ONE_USDC); // 100 * 1.05

      // Complete round 2
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([2n, 0n]);

      // Round 3: loyalty = 2 → mult = 1.10
      const infoR3 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR3.loyaltyRounds, 2n);
      assert.equal(infoR3.roundJoined, 3n);
      assert.equal(infoR3.weightBps, 110n * ONE_USDC); // 100 * 1.10
    });

    it("should reset loyalty to 0 when user fully withdraws and re-enters", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;

      // Round 1: deposit at Tier 3
      await enterGame(ctx, ctx.user1, amount, 3);

      // Complete round 1 → loyalty becomes 1
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 0n]);

      const infoR2 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR2.loyaltyRounds, 1n);

      // Full withdraw in round 2 → loyalty resets to 0
      await ctx.mmc.write.withdraw([amount], { account: ctx.user1.account });
      const afterWithdraw = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(afterWithdraw.loyaltyRounds, 0n);

      // Re-enter in round 2 → should have loyalty 0, no bonus
      await enterGame(ctx, ctx.user1, amount, 3);
      const afterReenter = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(afterReenter.loyaltyRounds, 0n);
      assert.equal(afterReenter.weightBps, 100n * ONE_USDC); // 100 * 1.0 * 1.0 (no loyalty bonus)
    });

    it("should NOT rollover user who fully withdrew", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;

      await enterGame(ctx, ctx.user1, amount, 3);
      // Withdraw everything during OPEN
      await ctx.mmc.write.withdraw([amount], { account: ctx.user1.account });

      // Complete round 1 (need another participant)
      await enterGame(ctx, ctx.user2, amount, 3);
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 0n]);

      // Round 2: user1 should NOT be enrolled
      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, 0n);
      assert.equal(info.roundJoined, 1n); // Not updated to round 2

      const participants = await ctx.mmc.read.getRoundParticipants([2n]);
      // Only user2 should be rolled over
      const user1InRound2 = participants.some(
        (p: string) => p.toLowerCase() === ctx.user1.account.address.toLowerCase(),
      );
      assert.equal(user1InRound2, false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4c. Blended Tier — 混合 tier 权重和利息计算
  // ════════════════════════════════════════════════════════════════════════
  describe("Blended Tier", async function () {
    it("should calculate blended weight from multiple tiers", async function () {
      const ctx = await deployAll();

      // 50 USDC at Tier 1 (weight mult 0.1) + 50 USDC at Tier 3 (weight mult 1.0)
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 3);

      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, 100n * ONE_USDC);
      // Blended weight: (50*1000 + 50*10000) / 10000 = 55 USDC
      assert.equal(info.weightBps, 55n * ONE_USDC);
    });

    it("should harvest yield using blended retain rate", async function () {
      const ctx = await deployAll();

      // 50 USDC at Tier 1 (retain 90%) + 50 USDC at Tier 3 (retain 0%)
      // Blended retain = (50*9000 + 50*0) / 100 = 4500 bps = 45%
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 3);

      // Simulate 10 USDC yield
      await simulateYield(ctx, 10n * ONE_USDC);

      // Record user balance before harvest
      const beforeHarvest = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);

      // Trigger harvest via performUpkeep
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);

      // After harvest, user should have received exactly 45% of 10 USDC yield = 4.5 USDC
      const afterHarvest = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);
      const userReceived = afterHarvest - beforeHarvest;

      // Exact: 4_500_000 (4.5 USDC), allow ±0.01 USDC for ERC4626 rounding
      const expected = 4_500_000n;
      const tolerance = 10_000n; // 0.01 USDC
      assert.ok(
        userReceived >= expected - tolerance && userReceived <= expected + tolerance,
        `User should receive ~4.5 USDC retained yield, got ${Number(userReceived) / 1e6}`,
      );

      // Verify prizePool received the rest (~5.5 USDC)
      const roundInfo = await ctx.mmc.read.getCurrentRoundInfo();
      assert.ok(
        roundInfo.prizePool >= 5_400_000n && roundInfo.prizePool <= 5_600_000n,
        `Prize pool should be ~5.5 USDC, got ${Number(roundInfo.prizePool) / 1e6}`,
      );
    });

    it("should reduce tier amounts and weight proportionally on partial withdrawal", async function () {
      const ctx = await deployAll();

      // 100 USDC at Tier 1 + 200 USDC at Tier 3
      await enterGame(ctx, ctx.user1, 100n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user1, 200n * ONE_USDC, 3);

      // Before: weight = (100*1000 + 200*10000) / 10000 = 210 USDC
      const infoBefore = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoBefore.weightBps, 210n * ONE_USDC);

      // Withdraw 150 USDC (50% of 300 total)
      await ctx.mmc.write.withdraw([150n * ONE_USDC], {
        account: ctx.user1.account,
      });

      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, 150n * ONE_USDC);
      // Proportional: tier1 = 100 - (100*150/300) = 50, tier3 = 200 - (200*150/300) = 100
      assert.equal(info.tier1Amount, 50n * ONE_USDC);
      assert.equal(info.tier3Amount, 100n * ONE_USDC);
      // Weight reduced proportionally: 210 - (210*150/300) = 105 USDC
      assert.equal(info.weightBps, 105n * ONE_USDC);
    });

    it("should zero all tier amounts on full withdrawal", async function () {
      const ctx = await deployAll();

      await enterGame(ctx, ctx.user1, 100n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user1, 200n * ONE_USDC, 3);

      await ctx.mmc.write.withdraw([300n * ONE_USDC], {
        account: ctx.user1.account,
      });

      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, 0n);
      assert.equal(info.tier1Amount, 0n);
      assert.equal(info.tier2Amount, 0n);
      assert.equal(info.tier3Amount, 0n);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. Withdraw with Penalty — 锁定期惩罚
  //    DRAWING 状态下取款：只拿回本金，利息被没收进奖池
  // ════════════════════════════════════════════════════════════════════════
  describe("Withdraw with Penalty", async function () {
    it("should return only principal when withdrawing during DRAWING phase", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      const yieldAmount = 10n * ONE_USDC;

      await enterGame(ctx, ctx.user1, amount, 2); // Tier 2: 50/50 分利息
      await simulateYield(ctx, yieldAmount);

      // 进入 DRAWING 状态
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);

      // 在 DRAWING 状态下取款
      const before = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);
      await ctx.mmc.write.withdraw([amount], { account: ctx.user1.account });
      const after = await ctx.mockUSDC.read.balanceOf([
        ctx.user1.account.address,
      ]);

      // ✅ 只收到本金（利息被没收，不含任何奖励）
      assert.equal(after - before, amount);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. Squad Distribution — 80% winner + 20% 队友按 weight 分配
  // ════════════════════════════════════════════════════════════════════════
  describe("Squad prize distribution", async function () {
    it("squad member should receive 20% of prize proportional to weight", async function () {
      const ctx = await deployAll();

      // user1 创建 squad，user2 加入
      await ctx.squadRegistry.write.createSquad({
        account: ctx.user1.account,
      });
      const squadId = await ctx.squadRegistry.read.userSquad([
        ctx.user1.account.address,
      ]);
      await ctx.squadRegistry.write.joinSquad([squadId], {
        account: ctx.user2.account,
      });

      // user1 Tier 3（权重 = 200 USDC，必赢）；user2 Tier 1（权重 = 5 USDC）
      const amount1 = 200n * ONE_USDC;
      const amount2 = 50n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount1, 3, squadId);
      await enterGame(ctx, ctx.user2, amount2, 1, squadId);

      await simulateYield(ctx, 20n * ONE_USDC);

      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);

      // 记录 user2 余额（performUpkeep 后：_harvestYield 已经给 Tier 1 用户发了保留的利息）
      const user2Before = await ctx.mockUSDC.read.balanceOf([
        ctx.user2.account.address,
      ]);

      // rand=0 → 第一个累积 weight >= 0 的参与者赢（即 user1，权重最大）
      await ctx.mockVRF.write.fulfillRequest([1n, 0n]);

      const user2After = await ctx.mockUSDC.read.balanceOf([
        ctx.user2.account.address,
      ]);

      // ✅ user2 作为 squad 队友应额外收到 20% 奖励
      assert.ok(
        user2After > user2Before,
        "Squad member should receive 20% prize share",
      );
    });
  });
});

