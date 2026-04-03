"use client";

import { useEffect, useState } from "react";
import { useAccount, useWatchContractEvent, useChainId } from "wagmi";
import { MMC_ABI, getAddresses, formatUsdc } from "@/lib/contracts";
import { Trophy, X, ExternalLink } from "lucide-react";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const PARTICLES = ["🏆", "🎉", "⭐", "✨", "🥳", "💰", "🎊", "👑"];

type DrawResult = {
  roundId: bigint;
  winner: string;
  prize: bigint;
};

export function WinnerModal() {
  const chainId = useChainId();
  const { address: connectedAddress } = useAccount();

  const addresses = (() => {
    try { return getAddresses(chainId); } catch { return null; }
  })();

  const [draw, setDraw] = useState<DrawResult | null>(null);
  const [phase, setPhase] = useState<"entering" | "shown" | "leaving">("entering");
  const [particles, setParticles] = useState<
    { id: number; emoji: string; x: number; delay: number; duration: number }[]
  >([]);

  const getShownKey = (roundId: string) => `mmc_winner_shown_${roundId}`;

  // Listen for DrawFulfilled event — fires the moment the tx is mined, no polling delay
  useWatchContractEvent({
    address: addresses?.mmc,
    abi: MMC_ABI,
    eventName: "DrawFulfilled",
    enabled: !!addresses?.mmc,
    onLogs(logs) {
      for (const log of logs) {
        const { roundId, winner, prize } = log.args as {
          roundId: bigint;
          winner: string;
          prize: bigint;
        };

        // Skip zero-winner (no participants / all-withdraw guard)
        if (!winner || winner === ZERO_ADDRESS) continue;

        const key = roundId.toString();
        try {
          if (localStorage.getItem(getShownKey(key))) continue;
        } catch { /* ignore */ }

        const p = Array.from({ length: 20 }, (_, i) => ({
          id: i,
          emoji: PARTICLES[i % PARTICLES.length],
          x: Math.random() * 100,
          delay: Math.random() * 1.5,
          duration: 2 + Math.random() * 2,
        }));
        setParticles(p);
        setDraw({ roundId, winner, prize });
        setPhase("entering");
      }
    },
  });

  // Animate in after mount
  useEffect(() => {
    if (!draw) return;
    const t = setTimeout(() => setPhase("shown"), 50);
    return () => clearTimeout(t);
  }, [draw]);

  function dismiss() {
    if (!draw) return;
    setPhase("leaving");
    try {
      localStorage.setItem(getShownKey(draw.roundId.toString()), "1");
    } catch { /* ignore */ }
    setTimeout(() => setDraw(null), 400);
  }

  if (!draw) return null;

  const isWinner =
    connectedAddress &&
    draw.winner.toLowerCase() === connectedAddress.toLowerCase();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      onClick={dismiss}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300"
        style={{ opacity: phase === "shown" ? 1 : 0 }}
      />

      {/* Confetti */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {particles.map((p) => (
          <span
            key={p.id}
            className="absolute text-2xl select-none"
            style={{
              left: `${p.x}%`,
              top: "-2rem",
              animation: `confettiFall ${p.duration}s ease-in ${p.delay}s both`,
            }}
          >
            {p.emoji}
          </span>
        ))}
      </div>

      {/* Modal card */}
      <div
        className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-amber-400/30 bg-[#111] shadow-2xl shadow-amber-500/20 transition-all duration-400"
        style={{
          transform: phase === "shown" ? "scale(1) translateY(0)" : "scale(0.85) translateY(40px)",
          opacity: phase === "shown" ? 1 : 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top glow strip */}
        <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-orange-500 to-amber-400" />

        {/* Close button */}
        <button
          onClick={dismiss}
          className="absolute right-4 top-4 rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-8 text-center">
          {/* Trophy icon with pulse rings */}
          <div className="relative mx-auto mb-6 flex h-24 w-24 items-center justify-center">
            <div className="absolute inset-0 animate-ping rounded-full bg-amber-400/20" />
            <div className="absolute inset-2 animate-pulse rounded-full bg-amber-400/10" />
            <div className="relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/40">
              <Trophy className="h-12 w-12 text-black" />
            </div>
          </div>

          {/* Round badge */}
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-400">
            Round #{draw.roundId.toString()} · Draw Complete
          </div>

          {/* Headline */}
          {isWinner ? (
            <>
              <h2 className="mb-2 text-3xl font-extrabold text-white">You Won! 🎉</h2>
              <p className="mb-6 text-white/50">
                Congratulations! Claim your prize on the Dashboard.
              </p>
            </>
          ) : (
            <>
              <h2 className="mb-2 text-2xl font-extrabold text-white">We Have a Winner!</h2>
              <p className="mb-6 text-white/50">The draw is complete. Better luck next round!</p>
            </>
          )}

          {/* Winner address card */}
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-1 text-xs font-medium uppercase tracking-widest text-white/40">
              Winner
            </div>
            <div className="flex items-center justify-center gap-2">
              <span className={`font-mono text-lg font-bold ${isWinner ? "text-amber-400" : "text-white"}`}>
                {shortAddr(draw.winner)}
                {isWinner && " (You)"}
              </span>
              <a
                href={`https://etherscan.io/address/${draw.winner}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-white/30 hover:text-white/60 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            {draw.prize > 0n && (
              <div className="mt-2 text-sm font-semibold text-emerald-400">
                Prize: ${formatUsdc(draw.prize)} USDC
              </div>
            )}
          </div>

          {/* CTA */}
          {isWinner ? (
            <a
              href="/dashboard"
              onClick={dismiss}
              className="btn-primary inline-block w-full text-center"
            >
              Go to Dashboard →
            </a>
          ) : (
            <button onClick={dismiss} className="btn-secondary w-full">
              Close
            </button>
          )}
        </div>

        <style jsx>{`
          @keyframes confettiFall {
            0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
            100% { transform: translateY(110vh) rotate(720deg); opacity: 0.2; }
          }
        `}</style>
      </div>
    </div>
  );
}
