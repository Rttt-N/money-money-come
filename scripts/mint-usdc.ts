/**
 * 给账户 mint 测试 MockUSDC，支持本地和 Sepolia。
 *
 * 用法:
 *   npx hardhat run scripts/mint-usdc.ts --network hardhatMainnet
 *   npx hardhat run scripts/mint-usdc.ts --network sepolia
 *
 * 可选环境变量:
 *   MINT_TO=0xabc...        # 目标地址（默认：部署者账户）
 *   MINT_AMOUNT=5000        # USDC 数量（默认 100000）
 *
 * PowerShell:
 *   $env:MINT_TO="0xabc..."; $env:MINT_AMOUNT="5000"; npx hardhat run scripts/mint-usdc.ts --network sepolia
 * bash/zsh:
 *   MINT_TO=0xabc... MINT_AMOUNT=5000 npx hardhat run scripts/mint-usdc.ts --network sepolia
 */
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { viem } = await network.connect();

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const addressesPath = path.join(__dirname, "../frontend/lib/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("请先部署合约: npx hardhat run scripts/deploy.ts --network <network>");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
  const usdcAddress = addresses[chainId.toString()]?.usdc;
  if (!usdcAddress || usdcAddress === "0x0000000000000000000000000000000000000000") {
    console.error(`addresses.json 中尚无 chainId ${chainId} 的 USDC 地址，请先部署合约。`);
    process.exit(1);
  }

  const [wallet] = await viem.getWalletClients();
  if (!wallet) {
    console.error("没有可用的钱包账户");
    process.exit(1);
  }

  const toArg = process.env.MINT_TO ?? readArg("--to");
  const amountArg = process.env.MINT_AMOUNT ?? readArg("--amount");

  const target = (toArg ?? wallet.account.address) as `0x${string}`;
  const usdcAmount = amountArg ? BigInt(amountArg) : 100_000n;
  if (usdcAmount <= 0n) {
    console.error("--amount 必须大于 0");
    process.exit(1);
  }

  const usdc = await viem.getContractAt("MockUSDC", usdcAddress as `0x${string}`);
  const amount = usdcAmount * 10n ** 6n; // USDC has 6 decimals
  await usdc.write.mint([target, amount]);

  console.log(`Minted ${usdcAmount.toString()} USDC to ${target} (chainId: ${chainId})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
