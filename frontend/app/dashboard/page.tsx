"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { useUserInfo } from "@/hooks/useUserInfo";
import { useRoundInfo } from "@/hooks/useRoundInfo";
import {
  MMC_ABI,
  formatUsdc,
  formatProbability,
  RoundState,
  MIN_DEPOSIT,
} from "@/lib/contracts";
import {
  TrendingUp,
  Trophy,
  LogOut,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Percent,
  Star,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { TierPieChart } from "@/components/TierPieChart";

const TIER_STYLES: Record<number, { gradient: string; ring: string; label: string; badge: string }> = {
  1: { gradient: "from-blue-500/20 to-cyan-500/20", ring: "border-blue-500/30", label: "The Worker", badge: "🔵" },
  2: { gradient: "from-purple-500/20 to-pink-500/20", ring: "border-purple-500/30", label: "The Player", badge: "🟣" },
  3: { gradient: "from-amber-500/20 to-orange-500/20", ring: "border-amber-500/30", label: "The VIP", badge: "🟠" },
};

export default function DashboardPage() {
  const { address } = useAccount();
  const { userInfo, winProb, usdcBalance, nftBalance, addresses, refetch } = useUserInfo();
  const { roundInfo, currentRound } = useRoundInfo();

  const [withdrawStep, setWithdrawStep] = useState<"idle" | "confirm" | "pending" | "done">("idle");
  const [partialAmount, setPartialAmount] = useState("");
  const [withdrawMode, setWithdrawMode] = useState<"full" | "partial">("full");
  const [finalWithdrawAmount, setFinalWithdrawAmount] = useState(0n); // BUG-03: capture before refetch zeroes principal
  const [claimStep, setClaimStep] = useState<"idle" | "pending" | "done">("idle");

  const { writeContractAsync } = useWriteContract();

  const { data: pendingPrize, refetch: refetchPrize } = useReadContract({
    address: addresses?.mmc,
    abi: MMC_ABI,
    functionName: "pendingWithdrawals",
    args: address ? [address] : undefined,
    query: {
      enabled: !!addresses?.mmc && !!address,
      refetchInterval: 10_000,
    },
  });

  const hasPrize = pendingPrize !== undefined && pendingPrize > 0n;

  async function handleClaim() {
    if (!addresses || !hasPrize) return;
    setClaimStep("pending");
    try {
      await writeContractAsync({
        address: addresses.mmc,
        abi: MMC_ABI,
        functionName: "claimPrize",
      });
      setClaimStep("done");
      await Promise.all([refetch(), refetchPrize()]);
    } catch (err) {
      console.error(err);
      setClaimStep("idle");
    }
  }

  const isInRound = userInfo && userInfo.principal > 0n;
  const roundState = roundInfo?.state ?? 0;
  const isDrawing = roundState === RoundState.DRAWING || roundState === RoundState.LOCKED;

  // Determine dominant tier (highest amount) for card styling
  const dominantTier = isInRound
    ? (userInfo!.tier3Amount >= userInfo!.tier2Amount && userInfo!.tier3Amount >= userInfo!.tier1Amount) ? 3
    : (userInfo!.tier2Amount >= userInfo!.tier1Amount) ? 2
    : 1
    : 1;
  const tierStyle = isInRound ? TIER_STYLES[dominantTier] : null;

  // Compute blended yield retain % for display
  // BUG-01: divide by principal directly (not principal/100) to get 0-100 percentage
  const blendedYieldRetain = isInRound && userInfo!.principal > 0n
    ? Number(
        (userInfo!.tier1Amount * 90n + userInfo!.tier2Amount * 50n) / userInfo!.principal
      )
    : 0;

  const partialAmountBig = (() => {
    try {
      const n = parseFloat(partialAmount);
      if (isNaN(n) || n <= 0) return 0n;
      return BigInt(Math.floor(n * 1_000_000));
    } catch {
      return 0n;
    }
  })();

  const withdrawAmount =
    withdrawMode === "full"
      ? userInfo?.principal ?? 0n
      : partialAmountBig;

  const canWithdraw =
    !!address &&
    !!addresses &&
    isInRound &&
    withdrawStep === "idle" &&
    withdrawAmount > 0n &&
    withdrawAmount <= (userInfo?.principal ?? 0n);

  const canSubmitWithdraw =
    !!address &&
    !!addresses &&
    isInRound &&
    withdrawAmount > 0n &&
    withdrawAmount <= (userInfo?.principal ?? 0n);

  async function handleWithdraw() {
    if (!canSubmitWithdraw) return;
    const capturedAmount = withdrawAmount; // BUG-03: capture before refetch zeroes principal
    setWithdrawStep("pending");
    try {
      await writeContractAsync({
        address: addresses!.mmc,
        abi: MMC_ABI,
        functionName: "withdraw",
        args: [withdrawAmount],
      });
      setFinalWithdrawAmount(capturedAmount);
      setWithdrawStep("done");
      await refetch();
    } catch (err) {
      console.error(err);
      setWithdrawStep("idle");
    }
  }

  if (!address) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="glass-card max-w-md w-full p-10 text-center">
          <div className="mb-4 text-5xl">🔒</div>
          <h2 className="mb-2 text-xl font-bold text-white">Connect Your Wallet</h2>
          <p className="text-white/50">Connect your wallet to view your dashboard.</p>
        </div>
      </div>
    );
  }

  if (withdrawStep === "done") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-emerald-400" />
        <h1 className="mb-4 text-3xl font-bold text-white">Withdrawal Successful</h1>
        <p className="mb-2 text-white/50">
          ${formatUsdc(finalWithdrawAmount)} USDC has been returned to your wallet.
        </p>
        <p className="mb-10 text-xs text-white/30">
          Balance: ${usdcBalance !== undefined ? formatUsdc(usdcBalance) : "—"} USDC
        </p>
        <div className="flex justify-center gap-4">
          <Link href="/play" className="btn-primary">
            Deposit Again
          </Link>
          <button onClick={() => setWithdrawStep("idle")} className="btn-secondary">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!isInRound) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="glass-card p-10">
          <div className="mb-4 text-5xl">🎫</div>
          <h2 className="mb-2 text-xl font-bold text-white">No active position</h2>
          <p className="mb-8 text-white/50">
            Deposit once and your funds automatically roll over into every future round.
            No need to re-deposit each week!
          </p>
          <Link href="/play" className="btn-primary">
            Join Round #{currentRound?.toString() ?? "…"}
          </Link>
        </div>
      </div>
    );
  }

  const loyaltyBonus = userInfo.loyaltyRounds > 0n
    ? Math.min(Number(userInfo.loyaltyRounds) * 5, 200)
    : 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      {/* Header */}
      <div className="mb-10">
        <h1 className="mb-1 text-3xl font-bold text-white">My Dashboard</h1>
        <p className="text-white/40 font-mono text-sm">
          {address.slice(0, 6)}…{address.slice(-4)}
        </p>
      </div>

      {/* Warning if drawing/locked */}
      {isDrawing && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-400">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">Round is in {["OPEN", "LOCKED", "DRAWING", "SETTLED"][roundState]} state</div>
            <div className="text-sm opacity-80">
              Withdrawing now will forfeit your accumulated yield (penalty). Your principal is
              always safe.
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: stats */}
        <div className="lg:col-span-2 space-y-4">
          {/* Ticket card */}
          <div
            className={`rounded-2xl border bg-gradient-to-br ${tierStyle!.gradient} ${tierStyle!.ring} p-6`}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{tierStyle!.badge}</span>
                <div>
                  <div className="text-xs font-medium uppercase tracking-widest text-white/40">
                    Your Ticket — Round #{currentRound?.toString()}
                  </div>
                  <div className="text-lg font-bold text-white">
                    {[userInfo.tier1Amount, userInfo.tier2Amount, userInfo.tier3Amount].filter(a => a > 0n).length > 1
                      ? "Mixed Strategy"
                      : tierStyle!.label}
                  </div>
                </div>
              </div>
              {nftBalance !== undefined && nftBalance > 0n && (
                <div className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white">
                  NFT #{nftBalance.toString()}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                {
                  icon: <TrendingUp className="h-4 w-4 text-emerald-400" />,
                  label: "Principal",
                  value: `$${formatUsdc(userInfo.principal)}`,
                  sub: "USDC",
                },
                {
                  icon: <Percent className="h-4 w-4 text-amber-400" />,
                  label: "Win Probability",
                  value: winProb ? formatProbability(winProb[0], winProb[1]) : "—",
                  sub: "this round",
                },
                {
                  icon: <Trophy className="h-4 w-4 text-purple-400" />,
                  label: "Weight",
                  value: (Number(userInfo.weightBps) / 100).toFixed(1),
                  sub: "points",
                },
                {
                  icon: <Star className="h-4 w-4 text-cyan-400" />,
                  label: "Loyalty",
                  value: `${userInfo.loyaltyRounds.toString()} rounds`,
                  sub: loyaltyBonus > 0 ? `+${loyaltyBonus}% bonus` : "No bonus yet",
                },
              ].map(({ icon, label, value, sub }) => (
                <div key={label} className="rounded-xl bg-black/30 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs text-white/40">
                    {icon}
                    {label}
                  </div>
                  <div className="font-bold text-white">{value}</div>
                  <div className="text-xs text-white/30">{sub}</div>
                </div>
              ))}
            </div>

            {/* Tier distribution breakdown */}
            {isInRound && (
              <div className="mt-4 space-y-3">
                <TierPieChart
                  tier1Amount={userInfo.tier1Amount}
                  tier2Amount={userInfo.tier2Amount}
                  tier3Amount={userInfo.tier3Amount}
                />
                <div className="flex gap-2">
                  <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-400">
                    Keep ~{blendedYieldRetain.toFixed(0)}% of yield
                  </span>
                  <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-400">
                    ~{(100 - blendedYieldRetain).toFixed(0)}% goes to pool
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Round Info */}
          {roundInfo && (
            <div className="glass-card p-5">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-white/40">
                Current Round Info
              </h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 text-sm">
                <div>
                  <div className="text-white/40">Prize Pool</div>
                  <div className="font-bold text-white">${formatUsdc(roundInfo.prizePool)}</div>
                </div>
                <div>
                  <div className="text-white/40">Total Deposited</div>
                  <div className="font-bold text-white">${formatUsdc(roundInfo.totalPrincipal)}</div>
                </div>
                <div>
                  <div className="text-white/40">State</div>
                  <div className="font-bold text-white">
                    {["OPEN", "LOCKED", "DRAWING", "SETTLED"][roundState]}
                  </div>
                </div>
              </div>
              {roundInfo.winner && roundInfo.winner !== "0x0000000000000000000000000000000000000000" && (
                <div className="mt-4 rounded-xl bg-amber-400/10 p-3 text-sm">
                  <span className="font-semibold text-amber-400">🏆 Winner: </span>
                  <span className="font-mono text-white/70">
                    {roundInfo.winner.slice(0, 10)}…{roundInfo.winner.slice(-6)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column: claim + withdraw panel */}
        <div className="space-y-4">
          {/* Claim Prize */}
          {hasPrize && claimStep !== "done" && (
            <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-6">
              <div className="mb-3 flex items-center gap-2">
                <Trophy className="h-5 w-5 text-amber-400" />
                <h3 className="font-semibold text-white">Prize Available</h3>
              </div>
              <div className="mb-4 text-2xl font-bold text-amber-400">
                ${formatUsdc(pendingPrize)} USDC
              </div>
              <button
                onClick={handleClaim}
                disabled={claimStep === "pending"}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {claimStep === "pending" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Claiming…
                  </>
                ) : (
                  "Claim Prize"
                )}
              </button>
            </div>
          )}
          {claimStep === "done" && (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-6 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
              <div className="font-semibold text-white">Prize Claimed!</div>
              <button onClick={() => setClaimStep("idle")} className="mt-2 text-xs text-white/40 underline">
                Dismiss
              </button>
            </div>
          )}

          <div className="glass-card p-6">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
              <Shield className="h-4 w-4 text-emerald-400" />
              Withdraw Funds
            </div>
            <p className="mb-5 text-xs text-white/40">
              Your position rolls over automatically each round. Withdraw anytime — interest
              may be penalised if the round is in LOCKED or DRAWING state.
            </p>

            {/* Full / Partial toggle */}
            <div className="mb-4 flex rounded-xl border border-white/10 overflow-hidden text-sm">
              {(["full", "partial"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setWithdrawMode(mode)}
                  className={`flex-1 py-2 capitalize transition-all ${
                    withdrawMode === mode
                      ? "bg-white/10 text-white font-semibold"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            {withdrawMode === "partial" ? (
              <div className="mb-4">
                <input
                  type="number"
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                  placeholder="Amount to withdraw"
                  min={Number(MIN_DEPOSIT) / 1e6}
                  max={Number(userInfo.principal) / 1e6}
                  className="input-field"
                />
                <div className="mt-1.5 flex justify-between text-xs text-white/30">
                  <span>Available: ${formatUsdc(userInfo.principal)}</span>
                  <button
                    className="text-amber-400 underline"
                    onClick={() => setPartialAmount((Number(userInfo.principal) / 1e6).toString())}
                  >
                    Max
                  </button>
                </div>
              </div>
            ) : (
              <div className="mb-4 rounded-xl bg-white/5 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/50">Withdraw amount</span>
                  <span className="font-bold text-white">${formatUsdc(userInfo.principal)}</span>
                </div>
              </div>
            )}

            {isDrawing && withdrawStep === "idle" && (
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-400/10 p-3 text-xs text-amber-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Yield will be forfeited (penalty round).
              </div>
            )}

            {withdrawStep === "confirm" ? (
              <div className="space-y-2">
                <p className="mb-3 text-xs text-white/50">
                  Are you sure? You will receive ${formatUsdc(withdrawAmount)} USDC.
                </p>
                <button onClick={handleWithdraw} className="btn-primary w-full">
                  Confirm Withdrawal
                </button>
                <button
                  onClick={() => setWithdrawStep("idle")}
                  className="btn-secondary w-full text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setWithdrawStep("confirm")}
                disabled={!canWithdraw}
                className="btn-secondary w-full flex items-center justify-center gap-2"
              >
                {withdrawStep === "pending" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    <LogOut className="h-4 w-4" />
                    Withdraw {withdrawMode === "full" ? "All" : ""}
                  </>
                )}
              </button>
            )}
          </div>

          {/* Quick links */}
          <div className="glass-card p-5 space-y-2 text-sm">
            <h3 className="mb-3 font-semibold text-white/60 uppercase tracking-widest text-xs">
              Quick Links
            </h3>
            <Link href="/squads" className="flex items-center justify-between rounded-lg p-2 hover:bg-white/5 text-white/60 hover:text-white transition-colors">
              <span>My Squad</span>
              <span>→</span>
            </Link>
            <Link href="/play" className="flex items-center justify-between rounded-lg p-2 hover:bg-white/5 text-white/60 hover:text-white transition-colors">
              <span>Deposit More</span>
              <span>→</span>
            </Link>
            <Link href="/" className="flex items-center justify-between rounded-lg p-2 hover:bg-white/5 text-white/60 hover:text-white transition-colors">
              <span>Round Stats</span>
              <span>→</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
