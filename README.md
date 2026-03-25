# MoneyMoneyCome — Local Development Guide (Hardhat Local + Next.js)

This repo contains two parts:
1. Contracts / backend: Hardhat (Solidity contracts + tests)
2. Frontend: Next.js 14 (App Router + wagmi/viem)

For course demo & development we currently use **local Hardhat only**:
- chainId: `31337`
- RPC: `http://127.0.0.1:8545`

We do **not** rely on Sepolia for local runs.

---

## 1. Install dependencies

From the repo root:

```bash
npm install
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

---

## 2. Compile & run backend tests (Hardhat)

From the repo root:

```bash
npx hardhat compile
npx hardhat test
```

Once tests pass, you can deploy to the local chain.

---

## 3. Start the local chain (Hardhat Node)

Open a new terminal (keep it running):

```bash
npx hardhat node
```

You should see:
- Local RPC: `http://127.0.0.1:8545`
- Prefunded test accounts (Account #0, #1, ...)
- Corresponding **Private Key** values (to import into MetaMask)

---

---

## 4. Deploy contracts to the local chain (updates frontend addresses)

Open another terminal at the repo root:

```bash
npx hardhat run scripts/deploy.ts --network localhost
```

After a successful deploy, it will write:
- `frontend/lib/addresses.json`

The frontend will then read deployed addresses for `chainId=31337`:
- `mmc / usdc / vault / squadRegistry / ticketNFT`

---

---

## 5. Mint local test USDC (MockUSDC)

Open another terminal at the repo root:

```bash
npx hardhat run scripts/mint-usdc.ts --network localhost
```

This script mints **MockUSDC** to a local Hardhat account so the frontend can run:
- `approve`
- `enterGame`

---

---

## 6. Start the frontend (Next.js)

Open a new terminal:

```bash
cd frontend
npm run dev
```

Open your browser:
- http://localhost:3000

---

---

## 7. MetaMask (optional but recommended)

If you are not familiar with MetaMask, follow this simplest path:

1. Install the MetaMask browser extension (Chrome/Edge, etc.)
2. Add network (Hardhat Local):
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
3. Import account:
   - Copy the **Private Key** from the `npx hardhat node` terminal output
   - MetaMask: `Import account` -> `Private key`
4. Make sure MetaMask is switched to the `Hardhat Local` network
5. In the frontend, click “Connect Wallet”, then go to `/play` to test deposit

---

## 8. Local Draw Testing (Full Round Lifecycle)

The local environment uses mock contracts (MockAavePool, MockVRFCoordinator), so draws must be triggered manually via scripts.

After deploying, the local `roundDuration` is automatically set to **300 seconds (5 min)**.

### Step-by-step

```bash
# 1. Make sure Hardhat node is running and contracts are deployed (steps 3-6 above)

# 2. Deposit via the frontend (/play) — at least one account must enterGame

# 3. Simulate Aave yield (so there's a prize pool)
npx hardhat run scripts/simulate-yield.ts --network localhost

# 4. Advance time + trigger performUpkeep (enters DRAWING state)
#    The script auto-reads roundDuration from the contract and advances time accordingly
npx hardhat run scripts/run-draw.ts --network localhost

# 5. Simulate VRF callback (picks winner, settles round, starts new round)
npx hardhat run scripts/fulfill-vrf.ts --network localhost

# 6. Claim prize — go to /dashboard, a “Prize Available” card appears if you won
#    Click “Claim Prize” to transfer winnings to your wallet
```

### Notes

- Prize goes to `pendingWithdrawals` mapping first (pull payment pattern). Users must call `claimPrize()` via the dashboard to receive USDC.
- After fulfilling VRF, the contract automatically starts a new round with rollover participants.
- If `run-draw.ts` says “Upkeep not needed”, ensure at least one account has deposited via `enterGame`.

---

## 9. Mint USDC to Multiple Accounts

The default `mint-usdc.ts` mints to Account #0. To mint to other accounts, use `MINT_TO`:

**PowerShell:**

```powershell
# Account #1 (index 1)
$env:MINT_TO=”0x70997970C51812dc3A010C7d01b50e0d17dc79C8”; npx hardhat run scripts/mint-usdc.ts --network localhost

# Account #2 (index 2)
$env:MINT_TO=”0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC”; npx hardhat run scripts/mint-usdc.ts --network localhost

# Custom amount (default is 100,000 USDC)
$env:MINT_TO=”0x70997970C51812dc3A010C7d01b50e0d17dc79C8”; $env:MINT_AMOUNT=”50000”; npx hardhat run scripts/mint-usdc.ts --network localhost
```

**Bash / zsh:**

```bash
MINT_TO=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 npx hardhat run scripts/mint-usdc.ts --network localhost
MINT_TO=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC npx hardhat run scripts/mint-usdc.ts --network localhost
```

---
