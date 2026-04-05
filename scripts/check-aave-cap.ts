/**
 * Check Aave V3 Sepolia USDC supply cap and current usage.
 *
 * Usage:
 *   npx hardhat run scripts/check-aave-cap.ts --network sepolia
 */

import { network } from "hardhat";
import { parseAbi, formatUnits } from "viem";

async function main() {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  const aavePool = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";
  const usdc = "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8";
  const aToken = "0x16dA4541aD1807f4443d92D26044C1147406EB80";

  // Aave PoolDataProvider on Sepolia
  const dataProvider = "0x3e9708d80f7B3e43118013075F7e95CE3AB31F31";

  const dataProviderAbi = parseAbi([
    "function getReserveCaps(address asset) view returns (uint256 borrowCap, uint256 supplyCap)",
    "function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
  ]);

  const erc20Abi = parseAbi([
    "function totalSupply() view returns (uint256)",
    "function decimals() view returns (uint8)",
  ]);

  console.log("━".repeat(50));
  console.log("  Aave V3 Sepolia — USDC Supply Cap Check");
  console.log("━".repeat(50));

  // Get supply cap
  try {
    const [borrowCap, supplyCap] = await publicClient.readContract({
      address: dataProvider,
      abi: dataProviderAbi,
      functionName: "getReserveCaps",
      args: [usdc],
    });
    console.log(`\nSupply Cap: ${supplyCap.toLocaleString()} USDC`);
    console.log(`Borrow Cap: ${borrowCap.toLocaleString()} USDC`);

    // Get current total aToken supply (= current total supplied)
    const totalSupply = await publicClient.readContract({
      address: aToken,
      abi: erc20Abi,
      functionName: "totalSupply",
    });
    console.log(`\nCurrent Total Supplied: ${formatUnits(totalSupply, 6)} USDC`);

    // Supply cap is in whole token units (not scaled by decimals)
    const capInUnits = supplyCap * 1_000_000n; // convert to 6 decimals
    const remaining = capInUnits > totalSupply ? capInUnits - totalSupply : 0n;
    console.log(`Remaining Capacity: ${formatUnits(remaining, 6)} USDC`);
    console.log(`\nCap Full: ${remaining === 0n ? "YES — this is why enterGame fails!" : "NO — there is room"}`);
  } catch (err: unknown) {
    console.log("\nFailed to read from DataProvider. Trying direct aToken totalSupply...");
    const e = err as { message?: string };
    console.log("Error:", e.message?.slice(0, 300));

    // Fallback: just check aToken total supply
    try {
      const totalSupply = await publicClient.readContract({
        address: aToken,
        abi: erc20Abi,
        functionName: "totalSupply",
      });
      console.log(`\naToken Total Supply: ${formatUnits(totalSupply, 6)} USDC`);
    } catch {
      console.log("Could not read aToken totalSupply either.");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
