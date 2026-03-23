import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

// ── Constants ──────────────────────────────────────────────────────────────────
const ONE_USDC = 10n ** 6n; // 1 USDC = 1_000_000 (6 decimals)
const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

describe("MoneyMoneyCome — 46 Test Cases", async function () {
  const { viem, provider } = await network.connect();

  // ── 部署所有合约 ──────────────────────────────────────────────────────────
  async function deployAll() {
    const [owner, user1, user2, user3] = await viem.getWalletClients();

    const mockUSDC = await viem.deployContract("MockUSDC");
    const mockAavePool = await viem.deployContract("MockAavePool", [mockUSDC.address]);
    const mockVRF = await viem.deployContract("MockVRFCoordinator");

    const aTokenAddress = await mockAavePool.read.aToken();
    const mockAToken = await viem.getContractAt("MockAToken", aTokenAddress);

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

    const mmc = await viem.deployContract("MoneyMoneyCome", [
      mockUSDC.address,
      vault.address,
      ticketNFT.address,
      squadRegistry.address,
      mockVRF.address,
      BYTES32_ZERO,
      1n,
      owner.account.address,
    ]);

    await vault.write.transferOwnership([mmc.address]);
    await ticketNFT.write.transferOwnership([mmc.address]);

    return {
      mmc, vault, ticketNFT, squadRegistry,
      mockUSDC, mockAavePool, mockVRF, mockAToken,
      owner, user1, user2, user3,
    };
  }

  type Ctx = Awaited<ReturnType<typeof deployAll>>;
  type WalletClient = Ctx["user1"];

  async function enterGame(
    ctx: Ctx,
    user: WalletClient,
    amount: bigint,
    tier: number,
    squadId = 0n,
  ) {
    await ctx.mockUSDC.write.mint([user.account.address, amount]);
    await ctx.mockUSDC.write.approve([ctx.mmc.address, amount], { account: user.account });
    await ctx.mmc.write.enterGame([amount, tier, squadId], { account: user.account });
  }

  async function simulateYield(ctx: Ctx, amount: bigint) {
    await ctx.mockAToken.write.simulateYield([ctx.vault.address, amount]);
    await ctx.mockUSDC.write.mint([ctx.mockAavePool.address, amount]);
  }

  async function increaseTime(seconds: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (provider as any).request({ method: "evm_increaseTime", params: [seconds] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (provider as any).request({ method: "evm_mine", params: [] });
  }

  // ════════════════════════════════════════════════════════════════════════
  // TC-01 ~ TC-02  Deployment
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-01~02: Deployment", async function () {
    it("TC-01: should start at round 1 in OPEN state", async function () {
      const ctx = await deployAll();
      const round = await ctx.mmc.read.currentRound();
      assert.equal(round, 1n);
      const info = await ctx.mmc.read.getCurrentRoundInfo();
      assert.equal(info.state, 0); // RoundState.OPEN
    });

    it("TC-02: YieldVault and TicketNFT owner should be the main contract", async function () {
      const ctx = await deployAll();
      const vaultOwner = await ctx.vault.read.owner();
      const nftOwner = await ctx.ticketNFT.read.owner();
      assert.equal(vaultOwner.toLowerCase(), ctx.mmc.address.toLowerCase());
      assert.equal(nftOwner.toLowerCase(), ctx.mmc.address.toLowerCase());
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TC-03 ~ TC-07  enterGame
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-03~07: enterGame", async function () {
    it("TC-03: should update user principal and tier amounts correctly", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 2);
      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, amount);
      assert.equal(info.tier1Amount, 0n);
      assert.equal(info.tier2Amount, amount);
      assert.equal(info.tier3Amount, 0n);
    });

    it("TC-04: should mint an NFT ticket on deposit", async function () {
      const ctx = await deployAll();
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 1);
      const balance = await ctx.ticketNFT.read.balanceOf([ctx.user1.account.address]);
      assert.equal(balance, 1n);
    });

    it("TC-05: Tier 1 weight = 10% of deposit, Tier 3 weight = 100% of deposit", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 1);
      const u1 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(u1.weightBps, 10n * ONE_USDC);
      await enterGame(ctx, ctx.user2, amount, 3);
      const u2 = await ctx.mmc.read.getUserInfo([ctx.user2.account.address]);
      assert.equal(u2.weightBps, 100n * ONE_USDC);
    });

    it("TC-06: should revert if deposit is below minimum (10 USDC)", async function () {
      const ctx = await deployAll();
      const tooLittle = 5n * ONE_USDC;
      await ctx.mockUSDC.write.mint([ctx.user1.account.address, tooLittle]);
      await ctx.mockUSDC.write.approve([ctx.mmc.address, tooLittle], { account: ctx.user1.account });
      await assert.rejects(async () => {
        await ctx.mmc.write.enterGame([tooLittle, 1, 0n], { account: ctx.user1.account });
      });
    });

    it("TC-07: should allow top-up deposit in same round (blended per-tier amounts)", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 1);
      await enterGame(ctx, ctx.user1, amount, 2);
      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, 200n * ONE_USDC);
      assert.equal(info.tier1Amount, 100n * ONE_USDC);
      assert.equal(info.tier2Amount, 100n * ONE_USDC);
      assert.equal(info.tier3Amount, 0n);
      assert.equal(info.weightBps, 60n * ONE_USDC);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TC-08 ~ TC-12  withdraw
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-08~12: withdraw", async function () {
    it("TC-08: should return full principal to user (no yield, no penalty)", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 2);
      const before = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      await ctx.mmc.write.withdraw([amount], { account: ctx.user1.account });
      const after = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      assert.equal(after - before, amount);
    });

    it("TC-09: should burn NFT ticket on full withdrawal", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 1);
      await ctx.mmc.write.withdraw([amount], { account: ctx.user1.account });
      const balance = await ctx.ticketNFT.read.balanceOf([ctx.user1.account.address]);
      assert.equal(balance, 0n);
    });

    it("TC-10: should revert if user has no deposit", async function () {
      const ctx = await deployAll();
      await assert.rejects(async () => {
        await ctx.mmc.write.withdraw([100n * ONE_USDC], { account: ctx.user1.account });
      });
    });

    it("TC-11: should allow two half withdrawals of full deposit (200 → 100 → 100)", async function () {
      const ctx = await deployAll();
      const deposit = 200n * ONE_USDC;
      const half = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, deposit, 2);
      const before = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      await ctx.mmc.write.withdraw([half], { account: ctx.user1.account });
      await ctx.mmc.write.withdraw([half], { account: ctx.user1.account });
      const after = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      assert.equal(after - before, deposit);
    });

    it("TC-12: should allow uneven partial withdrawals (5002 → 3000 → 2002)", async function () {
      const ctx = await deployAll();
      const deposit = 5002n * ONE_USDC;
      const first = 3000n * ONE_USDC;
      const rest = 2002n * ONE_USDC;
      await enterGame(ctx, ctx.user1, deposit, 2);
      const before = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      await ctx.mmc.write.withdraw([first], { account: ctx.user1.account });
      await ctx.mmc.write.withdraw([rest], { account: ctx.user1.account });
      const after = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      assert.equal(after - before, deposit);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TC-13  Full Round
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-13: Full Round", async function () {
    it("TC-13: should complete a full round and pay winner the prize", async function () {
      const ctx = await deployAll();
      const amount = 200n * ONE_USDC;
      const yieldAmount = 20n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 3);
      await simulateYield(ctx, yieldAmount);
      await increaseTime(2);
      const [upkeepNeeded] = await ctx.mmc.read.checkUpkeep(["0x"]);
      assert.equal(upkeepNeeded, true);
      await ctx.mmc.write.performUpkeep(["0x"]);
      const balanceBefore = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      await ctx.mockVRF.write.fulfillRequest([1n, 42n]);
      const balanceAfter = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      assert.ok(balanceAfter > balanceBefore, "Winner should receive the prize");
      const newRound = await ctx.mmc.read.currentRound();
      assert.equal(newRound, 2n);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TC-14 ~ TC-19  Rollover
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-14~19: Rollover", async function () {
    it("TC-14: should auto-enroll user into next round after settlement", async function () {
      const ctx = await deployAll();
      const amount = 200n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 3);
      await simulateYield(ctx, 20n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 42n]);
      assert.equal(await ctx.mmc.read.currentRound(), 2n);
      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, amount);
      assert.equal(info.roundJoined, 2n);
      assert.equal(info.loyaltyRounds, 1n);
      const roundInfo = await ctx.mmc.read.getCurrentRoundInfo();
      assert.equal(roundInfo.totalPrincipal, amount);
      assert.ok(roundInfo.totalWeight > 0n);
      const participants = await ctx.mmc.read.getRoundParticipants([2n]);
      assert.equal(participants.length, 1);
      assert.equal(participants[0].toLowerCase(), ctx.user1.account.address.toLowerCase());
    });

    it("TC-15: should give loyalty bonus weight after rollover", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 3);
      const infoR1 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR1.weightBps, 100n * ONE_USDC);
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 0n]);
      const infoR2 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR2.loyaltyRounds, 1n);
      assert.equal(infoR2.weightBps, 105n * ONE_USDC);
    });

    it("TC-16: should preserve blended tier amounts through rollover", async function () {
      const ctx = await deployAll();
      await enterGame(ctx, ctx.user1, 60n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user1, 40n * ONE_USDC, 3);
      const infoR1 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR1.tier1Amount, 60n * ONE_USDC);
      assert.equal(infoR1.tier3Amount, 40n * ONE_USDC);
      assert.equal(infoR1.weightBps, 46n * ONE_USDC);
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 42n]);
      const infoR2 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR2.tier1Amount, 60n * ONE_USDC);
      assert.equal(infoR2.tier3Amount, 40n * ONE_USDC);
      assert.equal(infoR2.principal, 100n * ONE_USDC);
      assert.equal(infoR2.loyaltyRounds, 1n);
      assert.equal(infoR2.weightBps, 48300000n);
    });

    it("TC-17: should accumulate loyalty across multiple rounds (1 → 2 → 3)", async function () {
      const ctx = await deployAll();
      await enterGame(ctx, ctx.user1, 100n * ONE_USDC, 3);
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 0n]);
      const infoR2 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR2.loyaltyRounds, 1n);
      assert.equal(infoR2.weightBps, 105n * ONE_USDC);
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([2n, 0n]);
      const infoR3 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR3.loyaltyRounds, 2n);
      assert.equal(infoR3.roundJoined, 3n);
      assert.equal(infoR3.weightBps, 110n * ONE_USDC);
    });

    it("TC-18: should reset loyalty to 0 when user fully withdraws and re-enters", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 3);
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 0n]);
      const infoR2 = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoR2.loyaltyRounds, 1n);
      await ctx.mmc.write.withdraw([amount], { account: ctx.user1.account });
      const afterWithdraw = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(afterWithdraw.loyaltyRounds, 0n);
      await enterGame(ctx, ctx.user1, amount, 3);
      const afterReenter = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(afterReenter.loyaltyRounds, 0n);
      assert.equal(afterReenter.weightBps, 100n * ONE_USDC);
    });

    it("TC-19: should NOT rollover user who fully withdrew", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 3);
      await ctx.mmc.write.withdraw([amount], { account: ctx.user1.account });
      await enterGame(ctx, ctx.user2, amount, 3);
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      await ctx.mockVRF.write.fulfillRequest([1n, 0n]);
      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, 0n);
      assert.equal(info.roundJoined, 1n);
      const participants = await ctx.mmc.read.getRoundParticipants([2n]);
      const user1InRound2 = participants.some(
        (p: string) => p.toLowerCase() === ctx.user1.account.address.toLowerCase(),
      );
      assert.equal(user1InRound2, false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TC-20 ~ TC-23  Blended Tier
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-20~23: Blended Tier", async function () {
    it("TC-20: should calculate blended weight from multiple tiers", async function () {
      const ctx = await deployAll();
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 3);
      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, 100n * ONE_USDC);
      assert.equal(info.weightBps, 55n * ONE_USDC);
    });

    it("TC-21: should harvest yield using blended retain rate", async function () {
      const ctx = await deployAll();
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 3);
      await simulateYield(ctx, 10n * ONE_USDC);
      const beforeHarvest = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      const afterHarvest = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      const userReceived = afterHarvest - beforeHarvest;
      const expected = 4_500_000n;
      const tolerance = 10_000n;
      assert.ok(
        userReceived >= expected - tolerance && userReceived <= expected + tolerance,
        `User should receive ~4.5 USDC retained yield, got ${Number(userReceived) / 1e6}`,
      );
      const roundInfo = await ctx.mmc.read.getCurrentRoundInfo();
      assert.ok(
        roundInfo.prizePool >= 5_400_000n && roundInfo.prizePool <= 5_600_000n,
        `Prize pool should be ~5.5 USDC, got ${Number(roundInfo.prizePool) / 1e6}`,
      );
    });

    it("TC-22: should reduce tier amounts and weight proportionally on partial withdrawal", async function () {
      const ctx = await deployAll();
      await enterGame(ctx, ctx.user1, 100n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user1, 200n * ONE_USDC, 3);
      const infoBefore = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(infoBefore.weightBps, 210n * ONE_USDC);
      await ctx.mmc.write.withdraw([150n * ONE_USDC], { account: ctx.user1.account });
      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, 150n * ONE_USDC);
      assert.equal(info.tier1Amount, 50n * ONE_USDC);
      assert.equal(info.tier3Amount, 100n * ONE_USDC);
      assert.equal(info.weightBps, 105n * ONE_USDC);
    });

    it("TC-23: should zero all tier amounts on full withdrawal", async function () {
      const ctx = await deployAll();
      await enterGame(ctx, ctx.user1, 100n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user1, 200n * ONE_USDC, 3);
      await ctx.mmc.write.withdraw([300n * ONE_USDC], { account: ctx.user1.account });
      const info = await ctx.mmc.read.getUserInfo([ctx.user1.account.address]);
      assert.equal(info.principal, 0n);
      assert.equal(info.tier1Amount, 0n);
      assert.equal(info.tier2Amount, 0n);
      assert.equal(info.tier3Amount, 0n);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TC-24  Withdraw with Penalty
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-24: Withdraw with Penalty", async function () {
    it("TC-24: should return only principal when withdrawing during DRAWING phase", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 2);
      await simulateYield(ctx, 10n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      const before = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      await ctx.mmc.write.withdraw([amount], { account: ctx.user1.account });
      const after = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      assert.equal(after - before, amount);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TC-25  Squad Prize Distribution
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-25: Squad Prize Distribution", async function () {
    it("TC-25: squad member should receive 20% of prize proportional to weight", async function () {
      const ctx = await deployAll();
      await ctx.squadRegistry.write.createSquad({ account: ctx.user1.account });
      const squadId = await ctx.squadRegistry.read.userSquad([ctx.user1.account.address]);
      await ctx.squadRegistry.write.joinSquad([squadId], { account: ctx.user2.account });
      const amount1 = 200n * ONE_USDC;
      const amount2 = 50n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount1, 3, squadId);
      await enterGame(ctx, ctx.user2, amount2, 1, squadId);
      await simulateYield(ctx, 20n * ONE_USDC);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);
      const user2Before = await ctx.mockUSDC.read.balanceOf([ctx.user2.account.address]);
      await ctx.mockVRF.write.fulfillRequest([1n, 0n]);
      const user2After = await ctx.mockUSDC.read.balanceOf([ctx.user2.account.address]);
      assert.ok(user2After > user2Before, "Squad member should receive 20% prize share");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TC-26 ~ TC-31  SquadRegistry
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-26~31: SquadRegistry", async function () {
    it("TC-26: createSquad should assign incremental squad ID starting from 1", async function () {
      const ctx = await deployAll();
      await ctx.squadRegistry.write.createSquad({ account: ctx.user1.account });
      const id = await ctx.squadRegistry.read.userSquad([ctx.user1.account.address]);
      assert.equal(id, 1n);
      const [leader, , active] = await ctx.squadRegistry.read.getSquad([1n]);
      assert.equal(leader.toLowerCase(), ctx.user1.account.address.toLowerCase());
      assert.equal(active, true);
    });

    it("TC-27: joinSquad should add caller to squad and update userSquad mapping", async function () {
      const ctx = await deployAll();
      await ctx.squadRegistry.write.createSquad({ account: ctx.user1.account });
      const id = await ctx.squadRegistry.read.userSquad([ctx.user1.account.address]);
      await ctx.squadRegistry.write.joinSquad([id], { account: ctx.user2.account });
      const memberCount = await ctx.squadRegistry.read.getMemberCount([id]);
      assert.equal(memberCount, 2n);
      const id2 = await ctx.squadRegistry.read.userSquad([ctx.user2.account.address]);
      assert.equal(id2, id);
    });

    it("TC-28: leaveSquad should remove caller from squad and reset userSquad to 0", async function () {
      const ctx = await deployAll();
      await ctx.squadRegistry.write.createSquad({ account: ctx.user1.account });
      const id = await ctx.squadRegistry.read.userSquad([ctx.user1.account.address]);
      await ctx.squadRegistry.write.joinSquad([id], { account: ctx.user2.account });
      await ctx.squadRegistry.write.leaveSquad({ account: ctx.user2.account });
      const memberCount = await ctx.squadRegistry.read.getMemberCount([id]);
      assert.equal(memberCount, 1n);
      const id2 = await ctx.squadRegistry.read.userSquad([ctx.user2.account.address]);
      assert.equal(id2, 0n);
    });

    it("TC-29: squad should deactivate when the last member leaves", async function () {
      const ctx = await deployAll();
      await ctx.squadRegistry.write.createSquad({ account: ctx.user1.account });
      const id = await ctx.squadRegistry.read.userSquad([ctx.user1.account.address]);
      await ctx.squadRegistry.write.leaveSquad({ account: ctx.user1.account });
      const [, , active] = await ctx.squadRegistry.read.getSquad([id]);
      assert.equal(active, false);
    });

    it("TC-30: should revert if user already in a squad tries to join another", async function () {
      const ctx = await deployAll();
      await ctx.squadRegistry.write.createSquad({ account: ctx.user1.account });
      await ctx.squadRegistry.write.createSquad({ account: ctx.user2.account });
      const id2 = await ctx.squadRegistry.read.userSquad([ctx.user2.account.address]);
      await assert.rejects(async () => {
        await ctx.squadRegistry.write.joinSquad([id2], { account: ctx.user1.account });
      });
    });

    it("TC-31: calcSquadPrize should give winner 80% and distribute remaining 20% by weight", async function () {
      const ctx = await deployAll();
      const totalPrize = 100n * ONE_USDC;
      const winner = ctx.user1.account.address as `0x${string}`;
      const addrs = [ctx.user1.account.address as `0x${string}`, ctx.user2.account.address as `0x${string}`];
      const weights = [200n * ONE_USDC, 50n * ONE_USDC]; // user1 huge weight (winner), user2 gets 20%

      const [winnerAmount, otherMembers, otherAmounts] =
        await ctx.squadRegistry.read.calcSquadPrize([winner, totalPrize, addrs, weights]);

      assert.equal(winnerAmount, 80n * ONE_USDC); // 80%
      assert.equal(otherMembers.length, 1);
      assert.equal(otherAmounts[0], 20n * ONE_USDC); // 20% — user2 is the only non-winner
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TC-32 ~ TC-34  TicketNFT
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-32~34: TicketNFT", async function () {
    it("TC-32: mint should record correct ticket metadata (roundId and tier amounts)", async function () {
      const ctx = await deployAll();
      const amount = 50n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 2);

      const tokenId = await ctx.ticketNFT.read.userRoundTicket([ctx.user1.account.address, 1n]);
      assert.ok(tokenId > 0n, "Token ID should be non-zero after deposit");

      const ticket = await ctx.ticketNFT.read.getTicket([tokenId]);
      assert.equal(ticket.roundId, 1n);
      assert.equal(ticket.tier2Amount, amount);
      assert.equal(ticket.tier1Amount, 0n);
      assert.equal(ticket.tier3Amount, 0n);
    });

    it("TC-33: burn should clear userRoundTicket mapping on full withdrawal", async function () {
      const ctx = await deployAll();
      const amount = 50n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 1);

      const tokenBefore = await ctx.ticketNFT.read.userRoundTicket([ctx.user1.account.address, 1n]);
      assert.ok(tokenBefore > 0n);

      await ctx.mmc.write.withdraw([amount], { account: ctx.user1.account });

      const tokenAfter = await ctx.ticketNFT.read.userRoundTicket([ctx.user1.account.address, 1n]);
      assert.equal(tokenAfter, 0n);
    });

    it("TC-34: totalSupply should increment by 1 for each mint", async function () {
      const ctx = await deployAll();
      const before = await ctx.ticketNFT.read.totalSupply();
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user2, 50n * ONE_USDC, 2);
      const after = await ctx.ticketNFT.read.totalSupply();
      assert.equal(after - before, 2n);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TC-35 ~ TC-36  YieldVault
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-35~36: YieldVault", async function () {
    it("TC-35: vault deposit should revert when called by a non-owner (non-MMC) address", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await ctx.mockUSDC.write.mint([ctx.user1.account.address, amount]);
      await ctx.mockUSDC.write.approve([ctx.vault.address, amount], { account: ctx.user1.account });
      await assert.rejects(async () => {
        await ctx.vault.write.deposit([amount, ctx.user1.account.address], {
          account: ctx.user1.account,
        });
      });
    });

    it("TC-36: totalAssets should equal aToken.balanceOf(vault) after deposit", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 2);

      const totalAssets = await ctx.vault.read.totalAssets();
      const aTokenBalance = await ctx.mockAToken.read.balanceOf([ctx.vault.address]);
      assert.equal(totalAssets, aTokenBalance);
      assert.ok(totalAssets > 0n, "totalAssets should be positive after deposit");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // TC-37 ~ TC-46  Additional MoneyMoneyCome
  // ════════════════════════════════════════════════════════════════════════
  describe("TC-37~46: Additional MoneyMoneyCome", async function () {
    it("TC-37: checkUpkeep should return false when there are no participants", async function () {
      const ctx = await deployAll();
      // Advance time well past ROUND_DURATION but no one deposited
      await increaseTime(2);
      const [upkeepNeeded] = await ctx.mmc.read.checkUpkeep(["0x"]);
      assert.equal(upkeepNeeded, false);
    });

    it("TC-38: checkUpkeep should return false after performUpkeep (state is no longer OPEN)", async function () {
      const ctx = await deployAll();
      await enterGame(ctx, ctx.user1, 100n * ONE_USDC, 3);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]); // round → DRAWING
      // checkUpkeep should now be false (state != OPEN)
      const [upkeepNeeded] = await ctx.mmc.read.checkUpkeep(["0x"]);
      assert.equal(upkeepNeeded, false);
    });

    it("TC-39: withdraw should revert if amount exceeds user principal", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 2);
      await assert.rejects(async () => {
        await ctx.mmc.write.withdraw([amount + 1n], { account: ctx.user1.account });
      });
    });

    it("TC-40: enterGame should revert with invalid tier value (0 or 4)", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      await ctx.mockUSDC.write.mint([ctx.user1.account.address, amount * 2n]);
      await ctx.mockUSDC.write.approve([ctx.mmc.address, amount * 2n], { account: ctx.user1.account });

      // Tier 0 is invalid
      await assert.rejects(async () => {
        await ctx.mmc.write.enterGame([amount, 0, 0n], { account: ctx.user1.account });
      });

      // Tier 4 is invalid
      await assert.rejects(async () => {
        await ctx.mmc.write.enterGame([amount, 4, 0n], { account: ctx.user1.account });
      });
    });

    it("TC-41: getWinProbability should return correct numerator and denominator", async function () {
      const ctx = await deployAll();
      // user1 Tier 3 → weight 100, user2 Tier 1 → weight 10
      await enterGame(ctx, ctx.user1, 100n * ONE_USDC, 3);
      await enterGame(ctx, ctx.user2, 100n * ONE_USDC, 1);

      const [num1, denom] = await ctx.mmc.read.getWinProbability([ctx.user1.account.address]);
      assert.equal(num1, 100n * ONE_USDC);
      assert.equal(denom, 110n * ONE_USDC); // 100 + 10

      const [num2] = await ctx.mmc.read.getWinProbability([ctx.user2.account.address]);
      assert.equal(num2, 10n * ONE_USDC);
    });

    it("TC-42: round totalPrincipal and totalWeight should update correctly with multiple depositors", async function () {
      const ctx = await deployAll();
      // user1: 100 USDC Tier 3 → weight 100; user2: 100 USDC Tier 1 → weight 10
      await enterGame(ctx, ctx.user1, 100n * ONE_USDC, 3);
      await enterGame(ctx, ctx.user2, 100n * ONE_USDC, 1);

      const info = await ctx.mmc.read.getCurrentRoundInfo();
      assert.equal(info.totalPrincipal, 200n * ONE_USDC);
      assert.equal(info.totalWeight, 110n * ONE_USDC);
    });

    it("TC-43: prize pool should accumulate 100% of yield from Tier 3 depositor", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      const yieldAmt = 10n * ONE_USDC;
      await enterGame(ctx, ctx.user1, amount, 3); // retain 0% → all yield to pool
      await simulateYield(ctx, yieldAmt);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);

      const info = await ctx.mmc.read.getCurrentRoundInfo();
      // prizePool ≈ 10 USDC (allow ±0.01 USDC ERC4626 rounding)
      assert.ok(
        info.prizePool >= 9_900_000n && info.prizePool <= 10_100_000n,
        `Prize pool should be ~10 USDC, got ${Number(info.prizePool) / 1e6}`,
      );
    });

    it("TC-44: enterGame should revert when round is not in OPEN state (DRAWING)", async function () {
      const ctx = await deployAll();
      await enterGame(ctx, ctx.user1, 100n * ONE_USDC, 3);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]); // now DRAWING

      const amount = 50n * ONE_USDC;
      await ctx.mockUSDC.write.mint([ctx.user2.account.address, amount]);
      await ctx.mockUSDC.write.approve([ctx.mmc.address, amount], { account: ctx.user2.account });

      await assert.rejects(async () => {
        await ctx.mmc.write.enterGame([amount, 1, 0n], { account: ctx.user2.account });
      });
    });

    it("TC-45: getRoundParticipants should list all depositors in the current round", async function () {
      const ctx = await deployAll();
      await enterGame(ctx, ctx.user1, 50n * ONE_USDC, 1);
      await enterGame(ctx, ctx.user2, 50n * ONE_USDC, 2);
      await enterGame(ctx, ctx.user3, 50n * ONE_USDC, 3);

      const participants = await ctx.mmc.read.getRoundParticipants([1n]);
      assert.equal(participants.length, 3);

      const addrs = participants.map((p: string) => p.toLowerCase());
      assert.ok(addrs.includes(ctx.user1.account.address.toLowerCase()));
      assert.ok(addrs.includes(ctx.user2.account.address.toLowerCase()));
      assert.ok(addrs.includes(ctx.user3.account.address.toLowerCase()));
    });

    it("TC-46: winner without a squad should receive the entire prize pool", async function () {
      const ctx = await deployAll();
      const amount = 100n * ONE_USDC;
      const yieldAmt = 10n * ONE_USDC;

      await enterGame(ctx, ctx.user1, amount, 3); // no squad
      await simulateYield(ctx, yieldAmt);
      await increaseTime(2);
      await ctx.mmc.write.performUpkeep(["0x"]);

      // Capture prizePool before VRF (after harvest)
      const roundInfoBeforeVRF = await ctx.mmc.read.getCurrentRoundInfo();
      const prizePool = roundInfoBeforeVRF.prizePool;
      assert.ok(prizePool > 0n, "Prize pool should be positive after harvest");

      const before = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);
      await ctx.mockVRF.write.fulfillRequest([1n, 42n]);
      const after = await ctx.mockUSDC.read.balanceOf([ctx.user1.account.address]);

      assert.equal(after - before, prizePool, "Sole winner should receive the full prize pool");
    });
  });
});
