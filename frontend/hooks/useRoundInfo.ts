"use client";

import { useReadContract, useChainId } from "wagmi";
import { MMC_ABI, VAULT_ABI, getAddresses } from "@/lib/contracts";
import { useEffect, useState } from "react";

export function useRoundInfo() {
  const chainId = useChainId();
  const addresses = (() => {
    try {
      return getAddresses(chainId);
    } catch {
      return null;
    }
  })();

  const { data: roundInfo, refetch } = useReadContract({
    address: addresses?.mmc,
    abi: MMC_ABI,
    functionName: "getCurrentRoundInfo",
    query: { enabled: !!addresses?.mmc, refetchInterval: 10_000 },
  });

  const { data: currentRound } = useReadContract({
    address: addresses?.mmc,
    abi: MMC_ABI,
    functionName: "currentRound",
    query: { enabled: !!addresses?.mmc, refetchInterval: 10_000 },
  });

  const { data: participants } = useReadContract({
    address: addresses?.mmc,
    abi: MMC_ABI,
    functionName: "getRoundParticipants",
    args: currentRound !== undefined ? [currentRound] : undefined,
    query: {
      enabled: !!addresses?.mmc && currentRound !== undefined,
      refetchInterval: 10_000,
    },
  });

  // Read vault.previewRedeem(enrolledVaultShares) — current USDC value of enrolled shares only.
  // This is accurate: excludes unenrolled users' principal and avoids over-counting.
  const { data: enrolledCurrentValue } = useReadContract({
    address: addresses?.vault,
    abi: VAULT_ABI,
    functionName: "previewRedeem",
    args: roundInfo ? [roundInfo.enrolledVaultShares] : undefined,
    query: {
      enabled: !!addresses?.vault && !!roundInfo && roundInfo.enrolledVaultShares > 0n,
      refetchInterval: 10_000,
    },
  });

  // Read totalRetainWeightedPrincipal = Σ(principal_i × retainBps_i / BPS_DENOM)
  // Used to split total yield into pool portion vs. user-retained portion.
  const { data: totalRetainWeightedPrincipal } = useReadContract({
    address: addresses?.mmc,
    abi: MMC_ABI,
    functionName: "totalRetainWeightedPrincipal",
    query: { enabled: !!addresses?.mmc, refetchInterval: 10_000 },
  });

  // Total yield accrued by enrolled shares this round.
  const totalAccruedYield =
    enrolledCurrentValue !== undefined && roundInfo && roundInfo.totalPrincipal > 0n
      ? enrolledCurrentValue > roundInfo.totalPrincipal
        ? enrolledCurrentValue - roundInfo.totalPrincipal
        : 0n
      : 0n;

  // Estimated yield going to prize pool = totalYield × (1 - retainFraction)
  // retainFraction = totalRetainWeightedPrincipal / totalPrincipal
  // toPool = totalYield × (totalPrincipal - totalRetainWeightedPrincipal) / totalPrincipal
  const accruedYield = (() => {
    if (totalAccruedYield === 0n || !roundInfo || roundInfo.totalPrincipal === 0n) return 0n;
    const retain = totalRetainWeightedPrincipal ?? 0n;
    const poolFraction = roundInfo.totalPrincipal > retain
      ? roundInfo.totalPrincipal - retain
      : 0n;
    return (totalAccruedYield * poolFraction) / roundInfo.totalPrincipal;
  })();

  // Countdown
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (!roundInfo) return;
    const endTime = Number(roundInfo.endTime) * 1000;

    const tick = () => {
      const diff = Math.max(0, endTime - Date.now());
      setTimeLeft(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [roundInfo]);

  return { roundInfo, currentRound, participants, timeLeft, accruedYield, refetch };
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "Ended";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}
