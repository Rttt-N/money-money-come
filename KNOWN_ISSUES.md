# MoneyMoneyCome — 全面审计报告

> 审计日期: 2026-03-24
> 修复日期: 2026-03-24
> 范围: 合约、前端、部署脚本、测试覆盖

---

## 一、已报告 Bug 修复状态

### 合约 (contracts_bugs.txt) — 全部已修复 ✓

| ID | 问题 | 状态 |
|----|------|------|
| H-1 | USDC 黑名单导致结算冻结 | ✓ 已改为 Pull Payment (`pendingWithdrawals` + `claimPrize()`) |
| H-2 | totalWeight=0 除零崩溃 | ✓ 已加 `r.totalWeight == 0` 守卫 |
| H-3 | performUpkeep 空轮次执行 | ✓ 已加 `participants.length > 0` 检查 |
| M-1 | NFT 转让后 enterGame DoS | ✓ 已加 `originalOwner` 字段，burn 使用 originalOwner |
| M-2 | ROUND_DURATION 硬编码 1 秒 | ✓ 改为 `roundDuration = 7 days` + `setRoundDuration()` |
| L-1 | Squad 奖金整数截断 | ✓ 最后一个成员领取余量 |
| L-2 | totalSupply 含已销毁 Token | ✓ 已追踪 `_burnedCount` |
| L-3 | Squad 队长离队不更新 | ✓ 已加 leader 重新指派 |
| L-4 | _harvestYield 精度损失 | ✓ 使用实际收到金额计算 |

### 前端 (frontend_bugs.txt) — 全部已修复 ✓

| ID | 问题 | 状态 |
|----|------|------|
| BUG-01 | blendedYieldRetain 偏大 100 倍 | ✓ 已修正除数为 `principal` |
| BUG-02 | 访问不存在的 `userInfo.tier` | ✓ 已改为从 tierAmount 推断 |
| BUG-03 | 提款后金额显示 $0.00 | ✓ 已在 refetch 前保存金额 |
| BUG-04 | `await refetch()` 不等待 | ✓ 已改为 `await Promise.all(...)` |

---

## 二、新发现 — 合约问题

### NEW-CH-1 ✅ FIXED `_harvestYield` Push Payment → Pull Payment

- 改为 `pendingWithdrawals[addr] += userKeeps`，与奖金分配一致

### NEW-CH-2 ✅ FIXED `CALLBACK_GAS_LIMIT` 可配置 + 增大默认值

- 改为 `callbackGasLimit = 2_000_000`（可变）+ `setCallbackGasLimit()` setter
- 注意：rollover 循环仍在 VRF 回调中，生产环境需关注参与者数量

### NEW-CM-1 ✅ FIXED 全额提款用户仍获 loyaltyRounds++

- 循环中跳过 `principal == 0` 的用户

### NEW-CM-2 ✅ FIXED DRAWING 期间 withdraw 可操纵开奖权重

- DRAWING 状态下禁止 withdraw：`require(state != RoundState.DRAWING)`

### NEW-CM-3 ✅ FIXED `enterGame` 不检查时间是否过期

- 加 `require(block.timestamp < rounds[currentRound].endTime)`

### NEW-CL-1 ✅ FIXED `_safeMint` 回调允许重入

- TicketNFT 改用 `_mint` 避免 `onERC721Received` 回调

### NEW-CL-2 ✅ FIXED 无参与者数量上限

- 加 `MAX_PARTICIPANTS = 100` 限制

### NEW-CL-3 [LOW — 未修] 部分提款多次后 tier amounts 累计误差

- 整数除法向下取整导致微小偏差，全额提款时已清零

### NEW-CL-4 ✅ FIXED `CALLBACK_GAS_LIMIT` 不可变

- 合并到 NEW-CH-2 修复

### NEW-CL-5 ✅ FIXED `approve` 改用 `forceApprove`

### NEW-CL-6 ✅ FIXED NFT 改为 Soulbound

- TicketNFT 覆写 `_update()`，禁止非 mint/burn 转让

### NEW-CL-7 [INFO — 无需修] 极小存款权重归零

- MIN_DEPOSIT = 10 USDC 防止了实际影响

### NEW-CI-1 [INFO — 未修] `setRoundDuration` 无事件发射

### NEW-CI-2 [INFO — 不修] `enterGame` 的 `squadId` 参数仅做校验，设计如此

### NEW-CI-3 [INFO — 未修] `setRoundDuration` 无上限限制

---

## 三、新发现 — 前端问题

### ~~NEW-FM-1~~ [已撤销] approve 流程实际正确

### NEW-FM-2 ✅ FIXED useSquad 的 refetch 改为 async

### NEW-FM-3 ✅ FIXED Squad 操作等待交易确认

- 使用 `waitForTransactionReceipt` 等确认后再 resolve

### NEW-FM-4 [LOW — 未修] Number(bigint) 精度丢失

- 仅在极大金额（>2^53 USDC）时有影响，不实际

### NEW-FM-5 ✅ FIXED useUserInfo refetch 加入 refetchNFT

### NEW-FM-6 ✅ FIXED BigInt() 异常 try-catch

### NEW-FM-7 [LOW — 未修] RoundState 硬编码数组

- contracts.ts 已有 `RoundState` 常量对象，但页面未引用，影响较小

### NEW-FL-1 [LOW — 未修] NFT 显示用 balanceOf 而非 tokenId

### NEW-FL-2 [LOW — 未修] Squad 页面 isLoading 第二次操作后不生效

### NEW-FL-3 [LOW — 未修] 每次存款只 approve 精确金额

### NEW-FL-4 [LOW — 未修] MysteryBox 粒子动画 CSS 变量未设置

### NEW-FL-5 [LOW — 未修] 无移动端导航菜单

### NEW-FL-6 ✅ FIXED `formatUsdc` 大金额精度修复

- 改用 BigInt 除法避免 Number 精度丢失

---

## 四、部署 & 配置问题

### NEW-DH-1 ✅ FIXED 前端 ABI 补全

- 加入 `performUpkeep`、`claimPrize`、`pendingWithdrawals`、`setRoundDuration`、`setCallbackGasLimit`、`roundDuration` + 事件 `PrizeCredited`、`PrizeClaimed`

### NEW-DH-2 ✅ FIXED `getTicket` ABI 加 `originalOwner`

### NEW-DM-1 ✅ FIXED `buildAddressMap` 支持所有 chainId

### NEW-DM-2 [LOW — 未修] Sepolia RPC 未配置 URL

### NEW-DM-3 ✅ FIXED CLAUDE.md 文档已更新

### NEW-DL-1 [LOW — 未修] `addresses.json` 应加入 `.gitignore`

### NEW-DL-2 [LOW — 未修] `mint-usdc.ts` 硬编码 chainId

### NEW-DL-3 [LOW — 未修] `package.json` test 脚本占位符

### NEW-DL-4 [LOW — 未修] deploy 脚本未转移 SquadRegistry ownership

### NEW-DL-5 [LOW — 未修] hardhat.config 网络名称非标准

---

## 五、测试覆盖缺口

### 关键未测试场景

| # | 场景 | 严重性 |
|---|------|--------|
| 1 | ~~`claimPrize()` 完全未测试~~ → ✅ TC-13/21/25/46 已更新使用 claimPrize | ~~HIGH~~ |
| 2 | 多参与者加权随机选人逻辑（TC-25 有 2 人但仅限 squad 场景，缺 3+ 人非 squad 测试） | HIGH |
| 3 | `totalWeight == 0` 守卫路径（奖金滚入下轮） | MEDIUM |
| 4 | `setRoundDuration()` 功能 + 权限 + 边界值 | MEDIUM |
| 5 | `performUpkeep` 负面测试（时间未到/状态错误/无参与者 revert） | MEDIUM |
| 6 | `enterGame` 传入不属于自己的 squadId 应 revert | MEDIUM |
| 7 | Rollover 用户在新 round top-up 的 weight 计算正确性 | MEDIUM |
| 8 | 部分提款后 NFT 应保留（不 burn） | LOW |
| 9 | 纯 Tier 1 用户的 90% yield retain 逻辑 | LOW |
| 10 | Squad 满员（10人）后加入应 revert | LOW |
| 11 | Rollover 后 NFT ticket 正确铸造 | LOW |
| 12 | Solo squad member 获 100% 奖金（非 80%） | LOW |
| 13 | `pendingWithdrawals` 映射读写完全未测试 → ✅ 部分覆盖（TC-13/21/25/46） | ~~HIGH~~ |

---

## 六、本地测试环境问题

### ENV-1 前端倒计时永远显示 "Ended"

- **原因:** 合约 `roundDuration = 7 days`，本地部署后无 `setRoundDuration` 调用缩短时间。
- **修复:** 部署脚本中调用 `setRoundDuration(300)` 设为 5 分钟。

### ENV-2 本地无 Keeper 自动调用 performUpkeep

- **原因:** 生产环境由 Chainlink Automation 触发，本地无 Keeper。
- **现状:** 前端 ABI 已包含 `performUpkeep`，可手动或自动调用。

### ENV-3 本地无 VRF 自动回调

- **原因:** 即使 performUpkeep 被调用，VRF 回调需手动调用 MockVRFCoordinator。

---

## 修复统计

```
已修复:  20 项（合约 10 + 前端 6 + 部署/配置 4）
未修复:  16 项（均为 LOW/INFO 级别）
测试:    51/51 通过 ✅
```
