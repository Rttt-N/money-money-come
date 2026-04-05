"use client";

import { useReadContract, useChainId, useAccount } from "wagmi";
import {
  MMC_ABI,
  ERC20_ABI,
  TICKET_NFT_ABI,
  getAddresses,
} from "@/lib/contracts";

export function useUserInfo() {
  const { address: userAddress } = useAccount();
  const chainId = useChainId();

  const addresses = (() => {
    try {
      return getAddresses(chainId);
    } catch {
      return null;
    }
  })();

  const { data: userInfo, refetch: refetchUser } = useReadContract({
    address: addresses?.mmc,
    abi: MMC_ABI,
    functionName: "getUserInfo",
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!addresses?.mmc && !!userAddress,
      refetchInterval: 10_000,
    },
  });

  const { data: winProb, refetch: refetchProb } = useReadContract({
    address: addresses?.mmc,
    abi: MMC_ABI,
    functionName: "getWinProbability",
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!addresses?.mmc && !!userAddress,
      refetchInterval: 10_000,
    },
  });

  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: addresses?.usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!addresses?.usdc && !!userAddress,
      refetchInterval: 10_000,
    },
  });

  const { data: usdcAllowance, refetch: refetchAllowance } = useReadContract({
    address: addresses?.usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args:
      userAddress && addresses?.mmc
        ? [userAddress, addresses.mmc]
        : undefined,
    query: {
      enabled: !!addresses?.usdc && !!userAddress && !!addresses?.mmc,
      refetchInterval: 5_000,
    },
  });

  const { data: nftBalance, refetch: refetchNFT } = useReadContract({
    address: addresses?.ticketNFT,
    abi: TICKET_NFT_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!addresses?.ticketNFT && !!userAddress,
      refetchInterval: 10_000,
    },
  });

  const { data: rolloverNeeded, refetch: refetchRollover } = useReadContract({
    address: addresses?.mmc,
    abi: MMC_ABI,
    functionName: "needsRollover",
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!addresses?.mmc && !!userAddress,
      refetchInterval: 10_000,
    },
  });

  // BUG-04: return Promise so callers can await actual data refresh
  const refetch = async () => {
    await Promise.all([refetchUser(), refetchProb(), refetchUsdc(), refetchAllowance(), refetchNFT(), refetchRollover()]);
  };

  return {
    userInfo,
    winProb,
    usdcBalance,
    usdcAllowance,
    nftBalance,
    rolloverNeeded,
    userAddress,
    addresses,
    refetch,
  };
}
