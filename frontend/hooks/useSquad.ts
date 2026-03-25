"use client";

import { useReadContract, useWriteContract, useChainId, useAccount, useWaitForTransactionReceipt } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { SQUAD_REGISTRY_ABI, getAddresses } from "@/lib/contracts";
import { config } from "@/lib/wagmi";
import { useState } from "react";

export function useSquad() {
  const { address: userAddress } = useAccount();
  const chainId = useChainId();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  const addresses = (() => {
    try {
      return getAddresses(chainId);
    } catch {
      return null;
    }
  })();

  const { data: squadId, refetch: refetchSquadId } = useReadContract({
    address: addresses?.squadRegistry,
    abi: SQUAD_REGISTRY_ABI,
    functionName: "userSquad",
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!addresses?.squadRegistry && !!userAddress,
      refetchInterval: 10_000,
    },
  });

  const { data: squadInfo, refetch: refetchSquadInfo } = useReadContract({
    address: addresses?.squadRegistry,
    abi: SQUAD_REGISTRY_ABI,
    functionName: "getSquad",
    args: squadId !== undefined && squadId !== 0n ? [squadId] : undefined,
    query: {
      enabled: !!addresses?.squadRegistry && !!squadId && squadId !== 0n,
      refetchInterval: 10_000,
    },
  });

  const { writeContractAsync, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // NEW-FM-3: wait for tx confirmation before resolving
  async function createSquad() {
    if (!addresses?.squadRegistry) return;
    const hash = await writeContractAsync({
      address: addresses.squadRegistry,
      abi: SQUAD_REGISTRY_ABI,
      functionName: "createSquad",
    });
    setTxHash(hash);
    await waitForTransactionReceipt(config, { hash });
  }

  async function joinSquad(id: bigint) {
    if (!addresses?.squadRegistry) return;
    const hash = await writeContractAsync({
      address: addresses.squadRegistry,
      abi: SQUAD_REGISTRY_ABI,
      functionName: "joinSquad",
      args: [id],
    });
    setTxHash(hash);
    await waitForTransactionReceipt(config, { hash });
  }

  async function leaveSquad() {
    if (!addresses?.squadRegistry) return;
    const hash = await writeContractAsync({
      address: addresses.squadRegistry,
      abi: SQUAD_REGISTRY_ABI,
      functionName: "leaveSquad",
    });
    setTxHash(hash);
    await waitForTransactionReceipt(config, { hash });
  }

  // NEW-FM-2: async refetch so callers can await
  const refetch = async () => {
    await Promise.all([refetchSquadId(), refetchSquadInfo()]);
  };

  return {
    squadId,
    squadInfo,
    createSquad,
    joinSquad,
    leaveSquad,
    isPending,
    isConfirming,
    isSuccess,
    refetch,
  };
}
