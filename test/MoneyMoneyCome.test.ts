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
    it("should update user principal and tier correctly", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 2);

      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, amount);
      assert.equal(info.tier, 2);
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

    it("should revert if user tries to deposit twice in same round", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 1);

      await ctx.mockUSDC.write.mint([ctx.user1.account.address, amount]);
      await ctx.mockUSDC.write.approve([ctx.mmc.address, amount], {
        account: ctx.user1.account,
      });

      await assert.rejects(async () => {
        await ctx.mmc.write.enterGame([amount, 1, 0n], {
          account: ctx.user1.account,
        });
      });
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

