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

