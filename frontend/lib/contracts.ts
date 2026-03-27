import { type Address } from "viem";

// ── ABI definitions ───────────────────────────────────────────────────────────

export const MMC_ABI = [
  // Views
  {
    name: "currentRound",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getCurrentRoundInfo",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "totalPrincipal", type: "uint256" },
          { name: "prizePool", type: "uint256" },
          { name: "totalWeight", type: "uint256" },
          { name: "state", type: "uint8" },
          { name: "winner", type: "address" },
        ],
      },
    ],
  },
  {
    name: "getUserInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "principal", type: "uint256" },
          { name: "vaultShares", type: "uint256" },
          { name: "tier1Amount", type: "uint256" },
          { name: "tier2Amount", type: "uint256" },
          { name: "tier3Amount", type: "uint256" },
          { name: "weightBps", type: "uint256" },
          { name: "loyaltyRounds", type: "uint256" },
          { name: "roundJoined", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getWinProbability",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "numerator", type: "uint256" },
      { name: "denominator", type: "uint256" },
    ],
  },
  {
    name: "getRoundParticipants",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
  {
    name: "checkUpkeep",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes" }],
    outputs: [
      { name: "upkeepNeeded", type: "bool" },
      { name: "performData", type: "bytes" },
    ],
  },
  // NEW-DH-1: missing view/write functions
  {
    name: "pendingWithdrawals",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "roundDuration",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  // Writes
  {
    name: "performUpkeep",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "performData", type: "bytes" }],
    outputs: [],
  },
  {
    name: "claimPrize",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "setRoundDuration",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newDuration", type: "uint256" }],
    outputs: [],
  },
  {
    name: "setCallbackGasLimit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newLimit", type: "uint32" }],
    outputs: [],
  },
  {
    name: "enterGame",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "tier", type: "uint8" },
      { name: "squadId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  // Events
  {
    name: "GameEntered",
    type: "event",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "roundId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "tier", type: "uint8", indexed: false },
    ],
  },
  {
    name: "Withdrawn",
    type: "event",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "principal", type: "uint256", indexed: false },
      { name: "interest", type: "uint256", indexed: false },
      { name: "penalised", type: "bool", indexed: false },
    ],
  },
  {
    name: "DrawFulfilled",
    type: "event",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "prize", type: "uint256", indexed: false },
    ],
  },
  {
    name: "RoundStarted",
    type: "event",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "startTime", type: "uint256", indexed: false },
      { name: "endTime", type: "uint256", indexed: false },
    ],
  },
  {
    name: "PrizeCredited",
    type: "event",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    name: "PrizeClaimed",
    type: "event",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

export const SQUAD_REGISTRY_ABI = [
  {
    name: "userSquad",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getSquad",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "squadId", type: "uint256" }],
    outputs: [
      { name: "leader", type: "address" },
      { name: "members", type: "address[]" },
      { name: "active", type: "bool" },
    ],
  },
  {
    name: "getMemberCount",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "squadId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "createSquad",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "squadId", type: "uint256" }],
  },
  {
    name: "joinSquad",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "squadId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "leaveSquad",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "SquadCreated",
    type: "event",
    inputs: [
      { name: "squadId", type: "uint256", indexed: true },
      { name: "leader", type: "address", indexed: true },
    ],
  },
  {
    name: "MemberJoined",
    type: "event",
    inputs: [
      { name: "squadId", type: "uint256", indexed: true },
      { name: "member", type: "address", indexed: true },
    ],
  },
  {
    name: "MemberLeft",
    type: "event",
    inputs: [
      { name: "squadId", type: "uint256", indexed: true },
      { name: "member", type: "address", indexed: true },
    ],
  },
] as const;

export const TICKET_NFT_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "userRoundTicket",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "roundId", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getTicket",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "roundId", type: "uint256" },
          { name: "originalOwner", type: "address" }, // NEW-DH-2: was missing, caused ABI decode shift
          { name: "tier1Amount", type: "uint256" },
          { name: "tier2Amount", type: "uint256" },
          { name: "tier3Amount", type: "uint256" },
          { name: "weightBasisPts", type: "uint256" },
          { name: "mintedAt", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// ── YieldVault ABI (minimal, for reading totalAssets) ─────────────────────────

export const VAULT_ABI = [
  {
    type: "function" as const,
    name: "totalAssets",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view" as const,
  },
] as const;

// ── Address map (updated by deploy script) ────────────────────────────────────

type ChainAddresses = {
  mmc: Address;
  usdc: Address;
  vault: Address;
  squadRegistry: Address;
  ticketNFT: Address;
};

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

// 本地部署后会把地址写入 addresses.json，前端优先使用该文件中的 31337 地址
import deployedAddresses from "./addresses.json";

const DEFAULT_MAP: Record<number, ChainAddresses> = {
  31337: {
    mmc: ZERO,
    usdc: ZERO,
    vault: ZERO,
    squadRegistry: ZERO,
    ticketNFT: ZERO,
  },
  11155111: {
    mmc: ZERO,
    usdc: ZERO,
    vault: ZERO,
    squadRegistry: ZERO,
    ticketNFT: ZERO,
  },
};

function buildAddressMap(): Record<number, ChainAddresses> {
  const map = { ...DEFAULT_MAP };
  const deployed = deployedAddresses as Record<string, ChainAddresses>;
  // NEW-DM-1: read both local and Sepolia addresses
  for (const [chainIdStr, addrs] of Object.entries(deployed)) {
    const chainId = Number(chainIdStr);
    if (addrs?.mmc && addrs.mmc !== ZERO) {
      map[chainId] = addrs;
    }
  }
  return map;
}

const ADDRESS_MAP = buildAddressMap();

export function getAddresses(chainId: number): ChainAddresses {
  const addrs = ADDRESS_MAP[chainId];
  if (!addrs) throw new Error(`No addresses configured for chainId ${chainId}`);
  return addrs;
}

// ── Round state enum ───────────────────────────────────────────────────────────

export const RoundState = {
  OPEN: 0,
  LOCKED: 1,
  DRAWING: 2,
  SETTLED: 3,
} as const;

export type RoundStateType = (typeof RoundState)[keyof typeof RoundState];

// ── Tier config ────────────────────────────────────────────────────────────────

export const TIERS = [
  {
    id: 1,
    name: "The Worker",
    yieldRetain: "90%",
    yieldPool: "10%",
    weightMultiplier: "0.1×",
    description: "Safe & steady. Keep most of your yield.",
    color: "from-blue-500 to-cyan-500",
    badge: "🔵",
  },
  {
    id: 2,
    name: "The Player",
    yieldRetain: "50%",
    yieldPool: "50%",
    weightMultiplier: "0.5×",
    description: "Balanced strategy. Half yield, half chance.",
    color: "from-purple-500 to-pink-500",
    badge: "🟣",
  },
  {
    id: 3,
    name: "The VIP",
    yieldRetain: "0%",
    yieldPool: "100%",
    weightMultiplier: "1.0×",
    description: "All in. Maximum win probability.",
    color: "from-amber-500 to-orange-500",
    badge: "🟠",
  },
] as const;

export const MIN_DEPOSIT = 10n * 10n ** 6n; // 10 USDC (6 decimals)
export const ONE_USDC = 10n ** 6n;

export function formatUsdc(amount: bigint): string {
  // NEW-FL-6: avoid Number() precision loss for large amounts
  const whole = amount / 1_000_000n;
  const frac = amount % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").slice(0, 2);
  return Number(whole).toLocaleString("en-US") + "." + fracStr;
}

export function formatProbability(
  numerator: bigint,
  denominator: bigint,
): string {
  if (denominator === 0n) return "0.00%";
  const pct = (Number(numerator) / Number(denominator)) * 100;
  return pct.toFixed(2) + "%";
}
