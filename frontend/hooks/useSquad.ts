"use client";

import { useReadContract, useWriteContract, useChainId, useAccount, useWaitForTransactionReceipt } from "wagmi";
import { SQUAD_REGISTRY_ABI, getAddresses } from "@/lib/contracts";
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

  async function createSquad() {
    if (!addresses?.squadRegistry) return;
    const hash = await writeContractAsync({
      address: addresses.squadRegistry,
      abi: SQUAD_REGISTRY_ABI,
      functionName: "createSquad",
    });
    setTxHash(hash);
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
  }

  async function leaveSquad() {
    if (!addresses?.squadRegistry) return;
    const hash = await writeContractAsync({
      address: addresses.squadRegistry,
      abi: SQUAD_REGISTRY_ABI,
      functionName: "leaveSquad",
    });
    setTxHash(hash);
  }

  const refetch = () => {
    refetchSquadId();
    refetchSquadInfo();
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
