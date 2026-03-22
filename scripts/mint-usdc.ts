/**
 * 给本地账户 mint 测试 USDC，便于前端测试。
 * - 默认 mint 给本地第一个账户（保持原有逻辑）
 * - 可选通过环境变量 MINT_TO 指定目标地址
 * - 可选通过环境变量 MINT_AMOUNT 指定 USDC 数量（单位: USDC，默认 100000）
 *
 * 用法:
 *   npx hardhat run scripts/mint-usdc.ts --network localhost
 *   # PowerShell
 *   $env:MINT_TO="0xabc..."; $env:MINT_AMOUNT="5000"; npx hardhat run scripts/mint-usdc.ts --network localhost
 *   # bash/zsh
 *   MINT_TO=0xabc... MINT_AMOUNT=5000 npx hardhat run scripts/mint-usdc.ts --network localhost
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
  const addressesPath = path.join(__dirname, "../frontend/lib/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("先运行: npx hardhat run scripts/deploy.ts --network localhost");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
  const usdcAddress = addresses["31337"]?.usdc;
  if (!usdcAddress || usdcAddress === "0x0000000000000000000000000000000000000000") {
    console.error("addresses.json 中尚无 USDC 地址，请先部署合约。");
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

  console.log("Minted", usdcAmount.toString(), "USDC to", target);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
