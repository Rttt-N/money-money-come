"use client";

import Link from "next/link";
import { useRoundInfo, formatCountdown } from "@/hooks/useRoundInfo";
import { formatUsdc } from "@/lib/contracts";
import { useUserInfo } from "@/hooks/useUserInfo";
import { Trophy, Users, TrendingUp, Clock, Zap, ShieldCheck } from "lucide-react";

const STATE_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "OPEN", color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30" },
  1: { label: "LOCKED", color: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  2: { label: "DRAWING", color: "text-purple-400 bg-purple-400/10 border-purple-400/30" },
  3: { label: "SETTLED", color: "text-white/40 bg-white/5 border-white/10" },
};

export default function HomePage() {
  const { roundInfo, currentRound, participants, timeLeft, accruedYield } = useRoundInfo();
  const { userInfo } = useUserInfo();

  const state = roundInfo?.state ?? 0;
  const stateDisplay = STATE_LABELS[state] ?? STATE_LABELS[0];
  const isInRound = userInfo && userInfo.principal > 0n;

  return (
    <div className="relative overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-amber-500/5 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-[400px] w-[400px] rounded-full bg-orange-500/5 blur-3xl" />
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-6 pt-24 pb-16 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/5 px-4 py-1.5 text-sm text-amber-400">
          <Zap className="h-3.5 w-3.5" />
          No-Loss DeFi Lottery — Your principal is always safe
        </div>

        <h1 className="mb-6 bg-gradient-to-br from-white via-white/90 to-white/50 bg-clip-text text-5xl font-extrabold tracking-tight text-transparent sm:text-6xl lg:text-7xl">
          Save. Earn. Win.
          <br />
          <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
            MoneyMoneyCome
          </span>
        </h1>

        <p className="mx-auto mb-10 max-w-2xl text-lg text-white/50">
          Deposit USDC, earn Aave yield, and enter verifiably fair weekly draws.
          Your principal is guaranteed — only yield goes to the prize pool.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4">
          {isInRound ? (
            <Link href="/dashboard" className="btn-primary">
              View My Dashboard
            </Link>
          ) : (
            <Link href="/play" className="btn-primary">
              Join This Round
            </Link>
          )}
          <Link href="/squads" className="btn-secondary">
            Form a Squad
          </Link>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {/* Prize Pool */}
          <div className="glass-card p-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-amber-400/80">
              <Trophy className="h-3.5 w-3.5" />
              Prize Pool
            </div>
            <div className="text-3xl font-bold text-white">
              {roundInfo
                ? `$${formatUsdc(roundInfo.prizePool + (accruedYield ?? 0n))}`
                : "—"}
            </div>
            <div className="mt-1 text-xs text-white/40">USDC</div>
            {accruedYield !== undefined && accruedYield > 0n && (
              <div className="mt-1 text-xs text-emerald-400">
                +${formatUsdc(accruedYield)} accruing from Aave
              </div>
            )}
          </div>

          {/* Countdown */}
          <div className="glass-card p-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-purple-400/80">
              <Clock className="h-3.5 w-3.5" />
              Time Left
            </div>
            <div className="text-3xl font-bold text-white">
              {roundInfo ? formatCountdown(timeLeft) : "—"}
            </div>
            <div className="mt-1 text-xs text-white/40">
              Round #{currentRound?.toString() ?? "…"}
            </div>
          </div>

          {/* Participants */}
          <div className="glass-card p-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-cyan-400/80">
              <Users className="h-3.5 w-3.5" />
              Participants
            </div>
            <div className="text-3xl font-bold text-white">
              {participants ? participants.length : "—"}
            </div>
            <div className="mt-1 text-xs text-white/40">this round</div>
          </div>

          {/* Total Deposited */}
          <div className="glass-card p-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-emerald-400/80">
              <TrendingUp className="h-3.5 w-3.5" />
              Total Deposited
            </div>
            <div className="text-3xl font-bold text-white">
              {roundInfo ? `$${formatUsdc(roundInfo.totalPrincipal)}` : "—"}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${stateDisplay.color}`}
              >
                {stateDisplay.label}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <h2 className="mb-10 text-center text-2xl font-bold text-white/80">
          How It Works
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              step: "01",
              icon: "💰",
              title: "Deposit USDC",
              desc: "Choose your tier and deposit at least 10 USDC. Your principal is never at risk.",
              color: "from-blue-500/10 to-cyan-500/10 border-blue-500/20",
            },
            {
              step: "02",
              icon: "📈",
              title: "Earn Yield on Aave",
              desc: "Funds are deployed to Aave V3. Yield accumulates and flows into the prize pool.",
              color: "from-purple-500/10 to-pink-500/10 border-purple-500/20",
            },
            {
              step: "03",
              icon: "🎲",
              title: "Weekly Draw",
              desc: "Chainlink VRF picks a winner. Higher tier = higher win probability. Squad members share prizes.",
              color: "from-amber-500/10 to-orange-500/10 border-amber-500/20",
            },
          ].map(({ step, icon, title, desc, color }) => (
            <div
              key={step}
              className={`rounded-2xl border bg-gradient-to-br ${color} p-6`}
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="text-3xl">{icon}</span>
                <span className="text-xs font-bold tracking-widest text-white/30">
                  STEP {step}
                </span>
              </div>
              <h3 className="mb-2 text-lg font-bold text-white">{title}</h3>
              <p className="text-sm text-white/50">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-white/5 bg-white/[0.02] py-16">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                icon: <ShieldCheck className="h-6 w-6 text-emerald-400" />,
                title: "Non-Custodial",
                desc: "Your principal is locked in immutable smart contracts. Only you can withdraw.",
              },
              {
                icon: <Zap className="h-6 w-6 text-amber-400" />,
                title: "Provably Fair",
                desc: "Winner selection uses Chainlink VRF — cryptographically verified randomness.",
              },
              {
                icon: <Users className="h-6 w-6 text-purple-400" />,
                title: "Squad Rewards",
                desc: "Team up with friends. Squad members share 20% of the prize when anyone wins.",
              },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="flex gap-4">
                <div className="mt-0.5 shrink-0">{icon}</div>
                <div>
                  <h3 className="mb-1 font-semibold text-white">{title}</h3>
                  <p className="text-sm text-white/50">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
