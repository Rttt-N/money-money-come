"use client";

import { formatUsdc } from "@/lib/contracts";

const TIERS = [
  { key: "tier1", label: "Worker", color: "#60a5fa", bgClass: "bg-blue-400" },
  { key: "tier2", label: "Player", color: "#c084fc", bgClass: "bg-purple-400" },
  { key: "tier3", label: "VIP", color: "#fbbf24", bgClass: "bg-amber-400" },
] as const;

interface TierPieChartProps {
  tier1Amount: bigint;
  tier2Amount: bigint;
  tier3Amount: bigint;
}

export function TierPieChart({ tier1Amount, tier2Amount, tier3Amount }: TierPieChartProps) {
  const amounts = [tier1Amount, tier2Amount, tier3Amount];
  const total = amounts.reduce((a, b) => a + b, 0n);
  if (total === 0n) return null;

  const pcts = amounts.map((a) => Number(a * 10000n / total) / 100);

  // SVG donut via stroke-dasharray
  const R = 50;
  const C = 2 * Math.PI * R; // circumference
  let offset = 0;

  const segments = TIERS.map((tier, i) => {
    const pct = pcts[i];
    if (pct === 0) return null;
    const dash = (pct / 100) * C;
    const seg = (
      <circle
        key={tier.key}
        cx="60"
        cy="60"
        r={R}
        fill="none"
        stroke={tier.color}
        strokeWidth="16"
        strokeDasharray={`${dash} ${C - dash}`}
        strokeDashoffset={-offset}
        transform="rotate(-90 60 60)"
      />
    );
    offset += dash;
    return seg;
  });

  const activeTiers = TIERS.filter((_, i) => amounts[i] > 0n);

  return (
    <div className="flex items-center gap-5">
      {/* Donut */}
      <div className="relative shrink-0">
        <svg width="100" height="100" viewBox="0 0 120 120">
          {/* Background ring */}
          <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="16" />
          {segments}
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-white/40">Total</span>
          <span className="text-sm font-bold text-white">${formatUsdc(total)}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="space-y-1.5">
        {activeTiers.map((tier, _i) => {
          const idx = TIERS.indexOf(tier);
          const amt = amounts[idx];
          const pct = pcts[idx];
          return (
            <div key={tier.key} className="flex items-center gap-2 text-xs">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${tier.bgClass}`} />
              <span className="text-white/60 w-12">{tier.label}</span>
              <span className="font-medium text-white">${formatUsdc(amt)}</span>
              <span className="text-white/30">({pct.toFixed(1)}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
