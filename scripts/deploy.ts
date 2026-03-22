import { network } from "hardhat";
import fs from "fs";
import path from "path";

const { viem } = await network.connect();

async function main() {
  const [deployer] = await viem.getWalletClients();
  console.log("Deploying with:", deployer.account.address);

  // 1. Mock contracts (local only — replace with real addresses on Sepolia)
  const mockUSDC = await viem.deployContract("MockUSDC");
  console.log("MockUSDC:", mockUSDC.address);

  const mockAavePool = await viem.deployContract("MockAavePool", [
    mockUSDC.address,
  ]);
  console.log("MockAavePool:", mockAavePool.address);

  const aTokenAddress = await mockAavePool.read.aToken();
  console.log("MockAToken:", aTokenAddress);

  const mockVRF = await viem.deployContract("MockVRFCoordinator");
  console.log("MockVRFCoordinator:", mockVRF.address);

  // 2. Core contracts
  const vault = await viem.deployContract("YieldVault", [
    mockUSDC.address,
    mockAavePool.address,
    aTokenAddress,
    deployer.account.address,
  ]);
  console.log("YieldVault:", vault.address);

  const squadRegistry = await viem.deployContract("SquadRegistry", [
    deployer.account.address,
  ]);
  console.log("SquadRegistry:", squadRegistry.address);

  const ticketNFT = await viem.deployContract("TicketNFT", [
    deployer.account.address,
  ]);
  console.log("TicketNFT:", ticketNFT.address);

  // 3. Main contract
  const BYTES32_ZERO =
    "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;
  const mmc = await viem.deployContract("MoneyMoneyCome", [
    mockUSDC.address,
    vault.address,
    ticketNFT.address,
    squadRegistry.address,
    mockVRF.address,
    BYTES32_ZERO,
    1n, // subscriptionId
    deployer.account.address,
  ]);
  console.log("MoneyMoneyCome:", mmc.address);

  // 4. Transfer ownership
  await vault.write.transferOwnership([mmc.address]);
  await ticketNFT.write.transferOwnership([mmc.address]);
  console.log("Ownership transferred to MoneyMoneyCome");

  // 5. Write addresses to frontend/lib/addresses.json
  const addresses = {
    31337: {
      mmc: mmc.address,
      usdc: mockUSDC.address,
      vault: vault.address,
      squadRegistry: squadRegistry.address,
      ticketNFT: ticketNFT.address,
      mockVRF: mockVRF.address,
    },
  };

  const outPath = path.join(
    path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, "$1"),
    "../frontend/lib/addresses.json",
  );

  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log("Addresses written to frontend/lib/addresses.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
