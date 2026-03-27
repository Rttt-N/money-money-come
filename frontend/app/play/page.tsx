"use client";

import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { parseUnits } from "viem";
import { useUserInfo } from "@/hooks/useUserInfo";
import { useRoundInfo } from "@/hooks/useRoundInfo";
import { useSquad } from "@/hooks/useSquad";
import {
  MMC_ABI,
  ERC20_ABI,
  TIERS,
  MIN_DEPOSIT,
  formatUsdc,
  RoundState,
} from "@/lib/contracts";
import { MysteryBox } from "@/components/MysteryBox";
import { AlertTriangle, CheckCircle2, Loader2, Info } from "lucide-react";
import Link from "next/link";

export default function PlayPage() {
  const { address } = useAccount();
  const { userInfo, usdcBalance, usdcAllowance, addresses, refetch } = useUserInfo();
  const { roundInfo } = useRoundInfo();
  const { squadId: userSquadId } = useSquad();

  const [selectedTier, setSelectedTier] = useState<1 | 2 | 3>(2);
  const [amountInput, setAmountInput] = useState("");
  const [squadIdInput, setSquadIdInput] = useState("");
  const [step, setStep] = useState<"form" | "approving" | "entering" | "done">("form");
  const [mintedTokenId, setMintedTokenId] = useState<bigint | null>(null);
  const [txError, setTxError] = useState("");

  const { writeContractAsync } = useWriteContract();

  const amountBig = (() => {
    try {
      const n = parseFloat(amountInput);
      if (isNaN(n) || n <= 0) return 0n;
      return parseUnits(amountInput, 6);
    } catch {
      return 0n;
    }
  })();

  const isOpen = roundInfo?.state === RoundState.OPEN;
  const alreadyIn = userInfo && userInfo.principal > 0n;
  const needsApprove = (usdcAllowance ?? 0n) < amountBig;
  const hasEnoughBalance = (usdcBalance ?? 0n) >= amountBig;
  const isValidAmount = amountBig >= MIN_DEPOSIT;

  const inSquad = userSquadId !== undefined && userSquadId !== 0n;
  const squadInputId = (() => {
    try { return BigInt(squadIdInput || "0"); } catch { return 0n; }
  })();
  const squadError =
    squadInputId !== 0n && (!inSquad || userSquadId !== squadInputId)
      ? "You are not a member of this squad. Join the squad first or leave blank to play solo."
      : "";

  const canSubmit =
    !!address &&
    isOpen &&
    isValidAmount &&
    hasEnoughBalance &&
    !squadError &&
    step === "form";

  async function handleSubmit() {
    if (!canSubmit || !addresses) return;
    setTxError("");
    const squadId = inSquad ? userSquadId : squadInputId;

    try {
      if (needsApprove) {
        setStep("approving");
        await writeContractAsync({
          address: addresses.usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [addresses.mmc, amountBig],
        });
        await refetch();
      }

      setStep("entering");
      await writeContractAsync({
        address: addresses.mmc,
        abi: MMC_ABI,
        functionName: "enterGame",
        args: [amountBig, selectedTier, squadId],
      });

      // Optimistically show ticket
      setMintedTokenId(1n);
      setStep("done");
      await refetch();
    } catch (err: unknown) {
      console.error(err);
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        || (err as { message?: string })?.message || "";
      if (msg.includes("not in that squad")) {
        setTxError("You are not a member of this squad. Join the squad first or leave blank.");
      } else if (msg.includes("round not open")) {
        setTxError("This round is not accepting deposits right now.");
      } else if (msg.includes("round time expired")) {
        setTxError("This round has expired. Wait for the next round.");
      } else if (msg.includes("round full")) {
        setTxError("This round is full (max 100 participants).");
      } else {
        setTxError("Transaction failed. Please try again.");
      }
      setStep("form");
    }
  }

  if (!address) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="glass-card max-w-md w-full p-10 text-center">
          <div className="mb-4 text-5xl">🔒</div>
          <h2 className="mb-2 text-xl font-bold text-white">Connect Your Wallet</h2>
          <p className="text-white/50">Connect your wallet to start playing.</p>
        </div>
      </div>
    );
  }

  if (step === "done" && mintedTokenId !== null) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="mb-6">
          <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-400" />
        </div>
        <h1 className="mb-4 text-3xl font-bold text-white">You&apos;re In! 🎉</h1>
        <p className="mb-10 text-white/50">
          Your deposit is now generating yield on Aave. Good luck in the draw!
        </p>
        <MysteryBox tier={selectedTier} amount={amountBig} />
        <div className="mt-10 flex justify-center gap-4">
          <Link href="/dashboard" className="btn-primary">
            View Dashboard
          </Link>
          <Link href="/" className="btn-secondary">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="mb-10">
        <h1 className="mb-2 text-3xl font-bold text-white">Join This Round</h1>
        <p className="text-white/50">
          Select your strategy, deposit USDC, and enter the draw.
        </p>
      </div>

      {alreadyIn && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-400">
          <Info className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">Active Position — Top Up</div>
            <div className="text-sm opacity-80">
              You have ${formatUsdc(userInfo!.principal)} deposited
              {userInfo!.tier1Amount > 0n && ` | T1: $${formatUsdc(userInfo!.tier1Amount)}`}
              {userInfo!.tier2Amount > 0n && ` | T2: $${formatUsdc(userInfo!.tier2Amount)}`}
              {userInfo!.tier3Amount > 0n && ` | T3: $${formatUsdc(userInfo!.tier3Amount)}`}.
              Add more funds below to increase your weight.{" "}
              <Link href="/dashboard" className="underline">
                View dashboard
              </Link>
            </div>
          </div>
        </div>
      )}

      {roundInfo !== undefined && !isOpen && !alreadyIn && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-400">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">Round is not accepting deposits</div>
            <div className="text-sm opacity-80">
              The current round is in {["OPEN","LOCKED","DRAWING","SETTLED"][roundInfo?.state ?? 0]} state.
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Tier Selection */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-white/40">
            Step 1 — Choose Your Tier
          </h2>
          <div className="space-y-3">
            {TIERS.map((tier) => (
              <button
                key={tier.id}
                onClick={() => { setSelectedTier(tier.id as 1 | 2 | 3); setTxError(""); }}
                className={`w-full rounded-2xl border p-5 text-left transition-all ${
                  selectedTier === tier.id
                    ? "border-amber-400/50 bg-amber-400/10 ring-2 ring-amber-400/20"
                    : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{tier.badge}</span>
                    <div>
                      <div className="font-bold text-white">{tier.name}</div>
                      <div className="text-sm text-white/50">{tier.description}</div>
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-white/40">Win weight</div>
                    <div className="font-bold text-white">{tier.weightMultiplier}</div>
                  </div>
                </div>
                <div className="mt-3 flex gap-4 text-xs">
                  <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-emerald-400">
                    Keep {tier.yieldRetain} yield
                  </span>
                  <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-amber-400">
                    Pool {tier.yieldPool} yield
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Amount Input */}
          <div className="mt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-white/40">
              Step 2 — Enter Amount
            </h2>
            <div className="relative">
              <input
                type="number"
                value={amountInput}
                onChange={(e) => { setAmountInput(e.target.value); setTxError(""); }}
                placeholder="0.00"
                min="10"
                className="input-field pr-20 text-xl font-bold"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-white/40">
                USDC
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-white/40">
              <span>Minimum: 10 USDC</span>
              <span>
                Balance: ${usdcBalance !== undefined ? formatUsdc(usdcBalance) : "—"}
                {usdcBalance !== undefined && usdcBalance > 0n && (
                  <button
                    className="ml-2 text-amber-400 underline"
                    onClick={() => setAmountInput((Number(usdcBalance) / 1_000_000).toString())}
                  >
                    Max
                  </button>
                )}
              </span>
            </div>
          </div>

          {/* Squad ID (optional) */}
          <div className="mt-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-white/40">
              Step 3 — Join a Squad (Optional)
            </h2>
            {inSquad ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                You&apos;re in Squad #{userSquadId.toString()} — it will be used automatically.
              </div>
            ) : (
              <>
                <input
                  type="number"
                  value={squadIdInput}
                  onChange={(e) => { setSquadIdInput(e.target.value); setTxError(""); }}
                  placeholder="Squad ID (leave blank to skip)"
                  className={`input-field ${squadError ? "border-red-400/50" : ""}`}
                />
                {squadError && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {squadError}
                  </p>
                )}
              </>
            )}
            <p className="mt-1.5 text-xs text-white/30">
              Squad members share 20% of the prize if anyone wins.{" "}
              <Link href="/squads" className="text-amber-400 underline">
                Create or find a squad →
              </Link>
            </p>
          </div>
        </div>

        {/* Summary Panel */}
        <div className="space-y-4">
          <div className="glass-card p-6">
            <h3 className="mb-4 font-semibold text-white">Summary</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-white/50">Strategy</span>
                <span className="font-medium text-white">
                  {TIERS.find((t) => t.id === selectedTier)?.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Deposit</span>
                <span className="font-medium text-white">
                  {amountInput ? `$${amountInput} USDC` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Win weight</span>
                <span className="font-medium text-white">
                  {TIERS.find((t) => t.id === selectedTier)?.weightMultiplier}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Your yield</span>
                <span className="font-medium text-white">
                  {TIERS.find((t) => t.id === selectedTier)?.yieldRetain}
                </span>
              </div>
            </div>

            <div className="my-4 border-t border-white/10" />

            <div className="mb-4 flex items-start gap-2 rounded-lg bg-white/5 p-3 text-xs text-white/40">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/60" />
              Your principal is always withdrawable. Only yield is at stake.
            </div>

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="btn-primary w-full"
            >
              {step === "approving" ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Approving USDC…
                </span>
              ) : step === "entering" ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Entering game…
                </span>
              ) : needsApprove ? (
                alreadyIn ? "Approve & Top Up" : "Approve & Enter"
              ) : (
                alreadyIn ? "Top Up Deposit" : "Enter Game"
              )}
            </button>

            {txError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-400/10 p-3 text-xs text-red-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {txError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
