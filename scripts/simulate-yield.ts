/**
 * 模拟 Aave 利息累积，支持本地和 Sepolia。
 * 读取 addresses.json 中的 mockAToken 地址，调用 simulateYield 注入额外利息。
 *
 * 用法:
 *   npx hardhat run scripts/simulate-yield.ts --network hardhatMainnet
 *   npx hardhat run scripts/simulate-yield.ts --network sepolia
 *
 * 可选环境变量:
 *   YIELD_AMOUNT=20        # 注入金额 (USDC, 默认 20)
 */
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { viem } = await network.connect();

async function main() {
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const addressesPath = path.join(__dirname, "../frontend/lib/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("请先部署合约: npx hardhat run scripts/deploy.ts --network <network>");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
  const chain = addresses[chainId.toString()];
  const mmcAddress = chain?.mmc as `0x${string}` | undefined;
  const vaultAddress = chain?.vault as `0x${string}` | undefined;

  if (!mmcAddress || !vaultAddress) {
    console.error(`Missing mmc/vault address for chainId ${chainId}. Please deploy contracts first.`);
    process.exit(1);
  }

  const amountUsdc = process.env.YIELD_AMOUNT ? BigInt(process.env.YIELD_AMOUNT) : 20n;
  if (amountUsdc <= 0n) {
    console.error("YIELD_AMOUNT must be greater than 0");
    process.exit(1);
  }

  const mmc = await viem.getContractAt("MoneyMoneyCome", mmcAddress);
  const vaultFromMmc = await mmc.read.vault();
  if (vaultFromMmc.toLowerCase() !== vaultAddress.toLowerCase()) {
    console.warn("Warning: vault in addresses.json differs from mmc.vault(). Using mmc.vault().");
  }

  const vault = await viem.getContractAt("YieldVault", vaultFromMmc);
  const aTokenAddr = await vault.read.aToken();
  const aToken = await viem.getContractAt("MockAToken", aTokenAddr);

  const amount = amountUsdc * 10n ** 6n; // USDC has 6 decimals
  await aToken.write.simulateYield([vaultFromMmc, amount]);

  console.log(`Simulated +${amountUsdc.toString()} USDC yield to vault ${vaultFromMmc} (chainId: ${chainId})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
