# MoneyMoneyCome — No-Loss DeFi Lottery

A no-loss lottery protocol built on Ethereum. Users deposit USDC, yield is generated on Aave V3, and Chainlink VRF picks a winner each round. **All depositors always get their full principal back.**

---

## Features

### Core Protocol
- **No-loss design** — principal is locked in smart contracts and always fully withdrawable
- **Aave V3 yield** — deposits are supplied to Aave via an ERC-4626 vault; yield flows into the prize pool
- **Chainlink VRF V2.5** — cryptographically verifiable randomness for winner selection
- **Chainlink Automation** — `checkUpkeep` / `performUpkeep` for trustless round transitions

### Tier System
| Tier | Name | Yield Kept | Win Weight |
|------|------|-----------|------------|
| 1 | The Worker | 90% | 0.1× |
| 2 | The Player | 50% | 0.5× |
| 3 | The VIP | 0% | 1.0× |

### Pull-Payment Pattern (Gas-Safe)
- `claimTicket()` — re-enroll into the next round after a draw (O(1), no participant loop)
- `claimYield(roundId)` — claim tier-retained yield after a settled round
- `claimPrize()` — winner pulls their winnings; no push to arbitrary addresses
- `needsRollover(address)` / `previewClaimYield(roundId, address)` — on-chain previews

### Squads
- Form groups of up to 10 members
- Squad members share **20%** of the prize when any member wins (split proportionally by weight)
- Winner keeps **80%**

### Loyalty Bonus
- +5% win weight per completed round stayed in (max 3× multiplier)
- Reset to 0 on full withdrawal

### Blended Tiers
- Top-up deposits can use a different tier in the same round
- Weight and yield-retain rate are calculated as a weighted average across all tier amounts

### Frontend
- Real-time prize pool estimate during OPEN state (uses `vault.previewRedeem(enrolledVaultShares)` + `totalRetainWeightedPrincipal` for accurate pool-only yield)
- Live countdown timer
- Winner announcement modal with confetti animation (event-driven via `DrawFulfilled`, no polling)
- Dashboard: claim ticket, claim yield, claim prize, withdraw
- Squad management UI

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart contracts | Solidity 0.8.28, OpenZeppelin 5.x |
| Test framework | Hardhat 3, hardhat-toolbox-viem, Node.js test runner |
| Frontend | Next.js 14 (App Router), TypeScript |
| Wallet | wagmi v2, viem v2, ConnectKit |
| Styling | Tailwind CSS |
| Yield | Aave V3 (mocked locally with MockAavePool) |
| Randomness | Chainlink VRF V2.5 (mocked locally with MockVRFCoordinator) |
| Automation | Chainlink Automation (checkUpkeep / performUpkeep) |

---

## Repository Structure

```
money-money-come/
├── contracts/
│   ├── MoneyMoneyCome.sol      # Main contract (game logic, VRF, Automation)
│   ├── YieldVault.sol          # ERC-4626 vault wrapping Aave V3
│   ├── SquadRegistry.sol       # Squad creation, membership, prize split
│   ├── TicketNFT.sol           # ERC-721 participation ticket
│   └── mocks/                  # Test-only mock contracts
│       ├── MockUSDC.sol
│       ├── MockAavePool.sol     # Includes MockAToken with simulateYield()
│       └── MockVRFCoordinator.sol
├── test/
│   ├── MoneyMoneyCome.test.ts  # 51-test comprehensive test suite (all pass)
│   └── Counter.t.sol           # Solidity fuzz tests
├── scripts/
│   ├── deploy.ts               # Deploy all contracts, writes addresses.json
│   ├── demo.ts                 # One-shot full round demo (no node needed)
│   ├── mint-usdc.ts            # Mint test USDC to an address
│   ├── simulate-yield.ts       # Inject Aave yield via MockAToken
│   ├── run-draw.ts             # Advance time + trigger performUpkeep
│   ├── fulfill-vrf.ts          # Fulfill VRF request via MockVRFCoordinator
│   ├── set-round-duration.ts   # Change round length (onlyOwner)
│   ├── set-callback-gas.ts     # Change VRF callback gas limit (onlyOwner)
│   ├── set-automation-forwarder.ts  # Bind Chainlink Automation forwarder (onlyOwner)
│   └── emergency-reset.ts     # Unstick a frozen round (onlyOwner)
├── frontend/
│   ├── app/                    # Pages: /, /play, /dashboard, /squads
│   ├── components/             # MysteryBox, WinnerModal, TierPieChart, Navbar…
│   ├── hooks/                  # useRoundInfo, useUserInfo, useSquad
│   └── lib/
│       ├── contracts.ts        # ABIs, address map, helpers
│       ├── wagmi.ts            # wagmi config (hardhat 31337 + Sepolia)
│       └── addresses.json      # Auto-written by deploy script — do not edit manually
├── hardhat.config.ts
└── package.json
```

---

## Installation

### Prerequisites

- Node.js 18+
- npm 9+
- MetaMask browser extension (for frontend testing)
- Git

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd money-money-come

# Install contract / Hardhat dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### 2. Compile contracts

```bash
npx hardhat compile
```

### 3. Run tests

```bash
npx hardhat test
# Expected: 51 passing (Node.js) + 3 passing (Solidity fuzz)
```

---

## Local Development (Hardhat + Next.js)

### Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| Local Hardhat | 31337 | http://127.0.0.1:8545 |
| Sepolia testnet | 11155111 | via `SEPOLIA_RPC_URL` env var |

### Step 1 — Start the local chain

Open a terminal and keep it running:

```bash
npx hardhat node
```

Note the printed private keys — you will import one into MetaMask.

### Step 2 — Deploy contracts

```bash
npx hardhat run scripts/deploy.ts --network hardhatMainnet
```

This writes `frontend/lib/addresses.json` with all deployed contract addresses.

### Step 3 — Mint test USDC

```bash
# Mint to Account #0 (default)
npx hardhat run scripts/mint-usdc.ts --network hardhatMainnet

# Mint to a specific address (PowerShell)
$env:MINT_TO="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; npx hardhat run scripts/mint-usdc.ts --network hardhatMainnet

# Custom amount (default is 100,000 USDC)
$env:MINT_TO="0x..."; $env:MINT_AMOUNT="50000"; npx hardhat run scripts/mint-usdc.ts --network hardhatMainnet
```

### Step 4 — Start the frontend

```bash
cd frontend
npm run dev
# Open http://localhost:3000
```

### Step 5 — Connect MetaMask

1. Add network: RPC `http://127.0.0.1:8545`, Chain ID `31337`
2. Import account: paste a private key from the `npx hardhat node` output
3. Switch MetaMask to the Hardhat Local network
4. Visit `/play` to deposit

### Step 6 — Run a full round

```bash
# Simulate Aave yield (adds prize to pool)
npx hardhat run scripts/simulate-yield.ts --network hardhatMainnet

# Advance time past round end and trigger performUpkeep (→ DRAWING state)
npx hardhat run scripts/run-draw.ts --network hardhatMainnet

# Fulfill VRF (picks winner, settles round, starts new round)
npx hardhat run scripts/fulfill-vrf.ts --network hardhatMainnet
```

After VRF fulfillment:
- The **WinnerModal** pops up on the frontend automatically
- Winner can go to `/dashboard` → **Claim Prize**
- All participants can go to `/dashboard` → **Claim Ticket** to re-enroll in the next round
- Tier 1/2 participants can **Claim Yield** to collect their retained yield

---

## One-Shot Demo (no running node needed)

Runs an entire round in a single in-process Hardhat environment:

```bash
npx hardhat run scripts/demo.ts --network hardhatMainnet

# Custom yield and random seed (PowerShell)
$env:YIELD_USDC="100"; $env:RANDOM_WORD="42"; npx hardhat run scripts/demo.ts --network hardhatMainnet
```

What it does:
1. Deploys all contracts
2. Mints USDC to 4 players (Alice / Bob / Carol / Dave)
3. Each player enters with a different tier and amount
4. Simulates Aave yield
5. Advances time, triggers `performUpkeep`
6. Calls VRF fulfillment to pick the winner
7. Demonstrates `claimTicket()` and `claimYield()` pull-pattern flow
8. Prints final results: winner, prize, balances

---

## Admin Scripts (onlyOwner)

All admin scripts read deployed addresses from `frontend/lib/addresses.json`.

### Change round duration

```bash
# PowerShell — set to 10 minutes
$env:ROUND_MINUTES=10; npx hardhat run scripts/set-round-duration.ts --network sepolia
```

> Note: also updates the current round's `endTime` if still OPEN.

### Change VRF callback gas limit

```bash
# PowerShell
$env:GAS_LIMIT=400000; npx hardhat run scripts/set-callback-gas.ts --network sepolia
```

### Bind Chainlink Automation forwarder

```bash
# PowerShell — run after registering Upkeep on automation.chain.link
$env:FORWARDER="0xYourForwarderAddress"; npx hardhat run scripts/set-automation-forwarder.ts --network sepolia
```

### Emergency reset (stuck round)

```bash
# Use when VRF callback fails and the round is stuck in DRAWING/LOCKED
npx hardhat run scripts/emergency-reset.ts --network sepolia
```

---

## Sepolia Testnet Deployment

### Prerequisites

Create a `.env` file in the project root (never commit this file):

```
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
SEPOLIA_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
VRF_SUBSCRIPTION_ID=12345
```

To get a VRF Subscription ID:
1. Visit https://vrf.chain.link/sepolia
2. Create a VRF V2.5 subscription and fund it with at least 2 LINK
3. Note the subscription ID — set it as `VRF_SUBSCRIPTION_ID`

### Deploy

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

### Post-deploy checklist

1. Add the deployed `MoneyMoneyCome` address as a **VRF Consumer** at https://vrf.chain.link/sepolia
2. Register an **Automation Upkeep** at https://automation.chain.link/sepolia (Logic trigger, target = MoneyMoneyCome)
3. Run the forwarder binding script (see Admin Scripts above)
4. Mint test USDC: `npx hardhat run scripts/mint-usdc.ts --network sepolia`
5. Import the MockUSDC token into MetaMask using the address from `addresses.json`
6. Make sure `frontend/lib/addresses.json` has the `11155111` entry

---

## Contract Architecture

### State Machine

```
OPEN → (performUpkeep) → LOCKED → (requestVRF) → DRAWING → (fulfillRandomWords) → SETTLED
                                                                                        ↓
                                                                               _startNewRound()
```

### Key Constants

```solidity
MIN_DEPOSIT        = 10 USDC      // minimum deposit per enterGame call
LOYALTY_BONUS_BPS  = 500          // +5% win weight per completed round
MAX_LOYALTY_MULT   = 30_000       // 3× maximum loyalty multiplier
BPS_DENOM          = 10_000       // basis point denominator
```

### Contracts

| Contract | Role |
|----------|------|
| `MoneyMoneyCome.sol` | Core: deposits, withdrawals, VRF, Automation, prize distribution |
| `YieldVault.sol` | ERC-4626 vault; supplies USDC to Aave, tracks shares |
| `SquadRegistry.sol` | Squad CRUD; `calcSquadPrize()` splits 80/20 |
| `TicketNFT.sol` | ERC-721; one ticket per user per round; stores tier metadata |

---

## Testing

**51 tests — all pass.**

| Suite | TCs | Coverage |
|-------|-----|---------|
| Deployment | TC-01~02 | Initial state, ownership |
| enterGame | TC-03~07 | Deposit, NFT mint, tier weights, top-up, validation |
| withdraw | TC-08~12 | Full/partial, NFT burn, loyalty reset, edge cases |
| Full Round | TC-13 | Complete lifecycle |
| Rollover | TC-14~19 | claimTicket, loyalty accumulation, reset on re-entry |
| Blended Tier | TC-20~23 | Mixed-tier weights, yield harvest, partial withdrawal |
| Withdraw with Penalty | TC-24 | DRAWING state penalty |
| Squad Prize | TC-25 | 80/20 split by weight |
| SquadRegistry | TC-26~31 | CRUD, duplicate join prevention |
| TicketNFT | TC-32~34 | Metadata, burn mapping, totalSupply |
| YieldVault | TC-35~36 | Access control, totalAssets |
| Additional MMC | TC-37~46 | Edge cases, getters, multi-depositor |
| Pull-Pattern Functions | TC-47~50 | claimTicket, claimYield, needsRollover, previewClaimYield |
| Unenrolled Yield Inflation Fix | TC-51 | Skipped-round shares do not inflate prize pool |

```bash
npx hardhat test
```

---

## Deployed Contract Addresses

### Local Hardhat (Chain ID: 31337)

| Contract | Address |
|----------|---------|
| MoneyMoneyCome | `0x0165878A594ca255338adfa4d48449f69242Eb8f` |
| MockUSDC | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| YieldVault | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| SquadRegistry | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| TicketNFT | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` |
| MockVRFCoordinator | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

> Local addresses are reset on every `npx hardhat node` + redeploy. The values above reflect the most recent local deployment.

### Sepolia Testnet (Chain ID: 11155111)

| Contract | Address |
|----------|---------|
| MoneyMoneyCome | `0x34d97fA2c079efBe1a2409EDb2E794560c5a987c` |
| MockUSDC | `0xc24EC100d5Cd75231Ee1779c133105A164f1E02b` |
| YieldVault | `0xeB3Ae36aDbE22DA8927e36df234aE7F8E8e7fa2c` |
| SquadRegistry | `0xFAD5bD031E0F0ed876870fA89c02AFC16b410438` |
| TicketNFT | `0x51BdD29Fc7a17dA3f83fB7E532eeA85C8EB0a060` |
| MockAToken | `0xb2FC32cC6bc119aE72A1a0a547b3aFf32EE56F8d` |

> To add MockUSDC to MetaMask on Sepolia: Import Token → paste the MockUSDC address above.

---

## Security Audit

See `test/security_audit_report.html` for the full audit report.
