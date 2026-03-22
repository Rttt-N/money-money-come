"use client";

import { useState, useEffect } from "react";
import { TIERS, formatUsdc } from "@/lib/contracts";

type Props = {
  tier: 1 | 2 | 3;
  amount: bigint;
};

const TIER_STYLES: Record<
  number,
  { gradient: string; glow: string; ring: string; badge: string; particles: string[] }
> = {
  1: {
    gradient: "from-blue-600 via-cyan-500 to-blue-400",
    glow: "shadow-cyan-500/40",
    ring: "ring-cyan-400/40",
    badge: "🔵",
    particles: ["💎", "🌊", "❄️", "⚡"],
  },
  2: {
    gradient: "from-purple-600 via-pink-500 to-purple-400",
    glow: "shadow-purple-500/40",
    ring: "ring-purple-400/40",
    badge: "🟣",
    particles: ["✨", "🎯", "💫", "🔮"],
  },
  3: {
    gradient: "from-amber-500 via-orange-500 to-yellow-400",
    glow: "shadow-amber-500/40",
    ring: "ring-amber-400/40",
    badge: "🟠",
    particles: ["🏆", "⭐", "🔥", "👑"],
  },
};

type Phase = "sealed" | "shaking" | "opening" | "revealed";

export function MysteryBox({ tier, amount }: Props) {
  const [phase, setPhase] = useState<Phase>("sealed");
  const [floatingParticles, setFloatingParticles] = useState<
    { id: number; emoji: string; x: number; y: number; delay: number }[]
  >([]);

  const tierConfig = TIERS.find((t) => t.id === tier)!;
  const style = TIER_STYLES[tier];

  // Auto-play animation
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("shaking"), 600);
    const t2 = setTimeout(() => setPhase("opening"), 1800);
    const t3 = setTimeout(() => {
      setPhase("revealed");
      // Spawn floating particles
      const particles = Array.from({ length: 12 }, (_, i) => ({
        id: i,
        emoji: style.particles[i % style.particles.length],
        x: Math.random() * 280 - 140,
        y: -(Math.random() * 200 + 60),
        delay: i * 0.08,
      }));
      setFloatingParticles(particles);
    }, 2800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [style.particles]);

  return (
    <div className="relative mx-auto flex flex-col items-center select-none">
      {/* Floating particles */}
      {phase === "revealed" &&
        floatingParticles.map((p) => (
          <span
            key={p.id}
            className="pointer-events-none absolute text-2xl"
            style={{
              left: "50%",
              top: "50%",
              transform: `translate(calc(-50% + ${p.x}px), calc(-50% + ${p.y}px))`,
              animation: `floatUp 1.2s ease-out ${p.delay}s both`,
            }}
          >
            {p.emoji}
          </span>
        ))}

      {/* Box */}
      <div
        className={`relative flex h-48 w-48 items-center justify-center rounded-3xl border bg-gradient-to-br ${style.gradient} shadow-2xl ${style.glow} ring-2 ${style.ring} transition-all duration-300
          ${phase === "shaking" ? "animate-[shake_0.4s_ease-in-out_3]" : ""}
          ${phase === "opening" ? "scale-110" : ""}
          ${phase === "revealed" ? "scale-100" : ""}
        `}
      >
        {phase !== "revealed" ? (
          <div className="flex flex-col items-center gap-2">
            <span className="text-6xl drop-shadow-lg">
              {phase === "sealed" ? "📦" : phase === "shaking" ? "🎁" : "✨"}
            </span>
            {phase === "sealed" && (
              <span className="text-xs font-bold tracking-widest text-white/60 uppercase">
                Opening…
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 px-4 text-center">
            <span className="text-5xl drop-shadow-lg">{style.badge}</span>
            <div className="mt-1 text-sm font-bold text-white drop-shadow">{tierConfig.name}</div>
            <div className="text-xs font-semibold text-white/70">
              ${formatUsdc(amount)} USDC
            </div>
          </div>
        )}

        {/* Shimmer overlay */}
        {phase === "opening" && (
          <div className="absolute inset-0 rounded-3xl bg-white/30 animate-pulse" />
        )}
      </div>

      {/* Ticket details below */}
      {phase === "revealed" && (
        <div
          className={`mt-6 w-full max-w-sm rounded-2xl border bg-white/5 p-5 text-sm ring-1 ${style.ring} backdrop-blur-sm`}
          style={{ animation: "fadeInUp 0.5s ease-out both" }}
        >
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xl">{style.badge}</span>
            <span className="font-bold text-white">{tierConfig.name} Ticket</span>
          </div>
          <div className="space-y-2 text-white/60">
            <div className="flex justify-between">
              <span>Deposited</span>
              <span className="font-semibold text-white">${formatUsdc(amount)} USDC</span>
            </div>
            <div className="flex justify-between">
              <span>Yield you keep</span>
              <span className="font-semibold text-emerald-400">{tierConfig.yieldRetain}</span>
            </div>
            <div className="flex justify-between">
              <span>Win weight</span>
              <span className="font-semibold text-amber-400">{tierConfig.weightMultiplier}</span>
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-white/5 p-3 text-center text-xs text-white/40">
            Your principal is always safe. Good luck! 🍀
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0) rotate(0deg); }
          20% { transform: translateX(-6px) rotate(-3deg); }
          40% { transform: translateX(6px) rotate(3deg); }
          60% { transform: translateX(-4px) rotate(-2deg); }
          80% { transform: translateX(4px) rotate(2deg); }
        }
        @keyframes floatUp {
          0% { opacity: 1; transform: translate(calc(-50% + var(--x, 0px)), -50%) scale(0.5); }
          100% { opacity: 0; transform: translate(calc(-50% + var(--x, 0px)), calc(-50% + var(--y, -120px))) scale(1.2); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
