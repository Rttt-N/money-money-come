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

  // Read vault totalAssets for real-time yield display
  const { data: vaultTotalAssets } = useReadContract({
    address: addresses?.vault,
    abi: VAULT_ABI,
    functionName: "totalAssets",
    query: { enabled: !!addresses?.vault, refetchInterval: 10_000 },
  });

  // Accrued yield = vault total assets - total principal deposited
  // Guard: when totalPrincipal=0 (new round, no one enrolled yet) the vault may still
  // hold funds from the previous round, making the subtraction wildly incorrect.
  const accruedYield =
    vaultTotalAssets !== undefined && roundInfo && roundInfo.totalPrincipal > 0n
      ? vaultTotalAssets > roundInfo.totalPrincipal
        ? vaultTotalAssets - roundInfo.totalPrincipal
        : 0n
      : 0n;

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
