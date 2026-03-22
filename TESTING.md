# 本地测试步骤

按下面顺序在 **三个终端** 里操作即可完成一次完整前端 + 合约测试。

---

## 1. 启动本地链（终端 1）

在项目**根目录** `MoneyMoneyCome/` 下执行：

```bash
npx hardhat node
```

保持运行。会看到一列测试账户和私钥，链 ID 为 **31337**。

---

## 2. 部署合约（终端 2）

**新开一个终端**，同样在项目**根目录**执行：

```bash
npx hardhat run scripts/deploy.ts --network localhost
```

部署成功后，脚本会把合约地址写入 `frontend/lib/addresses.json`，前端会自动使用这些地址。

---

## 3. 启动前端（终端 3）

再开一个终端：

```bash
cd frontend
npm run dev
```

浏览器打开 **http://localhost:3000**。

---

## 4. 连接钱包并测试

1. **添加本地网络**  
   在 MetaMask 中添加网络：
   - 网络名称：`Hardhat Local`
   - RPC URL：`http://127.0.0.1:8545`
   - Chain ID：`31337`
   - 货币符号：`ETH`

2. **导入测试账户**  
   在终端 1 的 `npx hardhat node` 输出里复制**第一个账户**的 **Private Key**，在 MetaMask 中「导入账户」粘贴。该账户在部署和 mint 时会被使用，既有测试 ETH 也能领取下面 mint 的 USDC。

3. **领取测试 USDC**  
   部署完成后，在项目根目录执行（会给上面第一个账户 mint 100,000 USDC）：

   ```bash
   npx hardhat run scripts/mint-usdc.ts --network localhost
   ```

   用 MetaMask 导入的必须是 **hardhat node 里第一个账户**，这样该地址才会有 USDC。

---

## 5. 手动 Mint 测试 USDC（可选）

若没有 `scripts/mint-usdc.ts`，在项目根目录执行：

```bash
npx hardhat console --network localhost
```

在 console 中（将 `MOCK_USDC_ADDRESS` 换成部署输出中的 MockUSDC 地址，`YOUR_WALLET_ADDRESS` 换成你的钱包地址）：

```javascript
const usdc = await hre.viem.getContractAt("MockUSDC", "MOCK_USDC_ADDRESS");
await usdc.write.mint(["YOUR_WALLET_ADDRESS", 10000000000n]); // 10000 USDC (6位小数)
```

---

## 测试流程建议

1. **首页**：查看当前奖池、倒计时、参与人数。
2. **Play**：选 Tier → 输入金额（≥10 USDC）→ Approve → Enter Game → 看 Mystery Box 动画。
3. **Dashboard**：查看本金、权重、中奖概率、取款。
4. **Squads**：创建战队 → 记下 Squad ID → 换账号加入 → 查看成员列表。

每次**重新部署**合约后，需要重新执行一次步骤 2，前端会从更新后的 `addresses.json` 读取新地址（若前端已启动，刷新页面即可）。
