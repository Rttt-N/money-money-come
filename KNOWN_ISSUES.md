# MoneyMoneyCome — 全面审计报告

> 初始审计: 2026-03-24
> 最后更新: 2026-04-04
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

### NEW-CH-2 ✅ FIXED `CALLBACK_GAS_LIMIT` 可配置 + Pull Pattern 重构消除 O(N) 回调

- `callbackGasLimit` 改为可变（`setCallbackGasLimit()` setter），默认值降至 `400_000`
- **Pull Pattern 重构**（2026-04 追加修复）：VRF 回调中的 O(N) rollover 循环完全移除
  - `fulfillRandomWords()` 现在是 O(1)：仅写入奖金到 `pendingWithdrawals`，启动新轮次
  - `_startNewRound()` O(1)：仅初始化 `RoundInfo` struct，不再循环用户
  - 用户需自行调用 `claimTicket()` 重新参与下一轮（O(1) per user）
  - 用户需自行调用 `claimYield(roundId)` 领取留存收益

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

### NEW-CH-3 ✅ FIXED 未参与轮次的用户 vault shares 带入新轮次导致奖池虚高

- **根因**：用户跳过若干轮次后调用 `claimTicket()`，其 `vaultShares` 在跳过期间自然累积了 Aave yield，但这段 yield 未经过任何 `_harvestYieldGlobal()` 处理。将这批 shares 直接加入 `enrolledVaultShares` 后，`_harvestYieldGlobal()` 会将跳过期间的 yield 也算入本轮奖池，造成虚高。
- **修复**：`_processRollover()` 中，若 `!wasEnrolled || currentRound > prevRound + 1`（即跳过过至少一轮），先 redeem 多余的 yield shares 并存入 `pendingWithdrawals`（用户 100% 自留），再将剩余 shares（仅代表 principal）加入 `enrolledVaultShares`。
- **测试**：TC-51 覆盖此场景。

### NEW-CH-4 ✅ FIXED `r.prizePool` 结算后未归零

- **根因**：`fulfillRandomWords()` 中奖金支付后，`r.prizePool` 字段未清零，历史轮次读取时返回已派发的金额，误导前端显示。
- **修复**：在三处结算路径均加 `r.prizePool = 0`：
  1. 主赢家路径（`fulfillRandomWords` 正常流程）
  2. `totalWeight == 0` 守卫路径（奖金滚入下轮）
  3. `performUpkeep` 无参与者路径（奖金滚入下轮）

---

## 三、新发现 — 前端问题

### NEW-FM-1 ✅ FIXED approve tx 未等待上链即发送 enterGame

- **根因**：`writeContractAsync` 在钱包签字、tx **广播**后即返回，并不等待链上确认。approve tx 还未上链时代码已调用 `enterGame`，合约读到 allowance 仍为 0，导致 revert。第一次点击必定失败，第二次点击（approve 已上链）才能成功。
- **修复**：approve 后调用 `publicClient.waitForTransactionReceipt({ hash: approveTxHash })`，确认上链后再发 `enterGame`。

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

### NEW-FL-7 ✅ FIXED 前端缺少 Pull Pattern 交互（claimTicket / claimYield）

- **根因**：合约改为 Pull Pattern 后，用户需手动调用 `claimTicket()` 重新参与下一轮，`claimYield(roundId)` 领取留存收益。前端 Dashboard 完全没有这两个入口。
- **修复**：
  - `useUserInfo` 新增 `needsRollover()` 轮询
  - Dashboard 新增 Claim Ticket 面板（当 `needsRollover === true` 时显示）
  - Dashboard 新增 Claim Yield 面板（当 `previewClaimYield > 0` 时显示）
  - 修正 Dashboard 旧文案中"自动 rollover"的错误说法

### NEW-FL-8 ✅ FIXED `getCurrentRoundInfo` ABI 缺少 `enrolledVaultShares` 字段

- **根因**：ABI tuple 中 `enrolledVaultShares` 字段缺失，导致后续字段全部偏移（`prizePool` 解码为 `totalWeight` 的值等），前端奖池显示严重错误。
- **修复**：在 ABI tuple 中 `totalPrincipal` 与 `prizePool` 之间补充 `enrolledVaultShares: uint256`。

### NEW-FL-9 ✅ FIXED 前端奖池估算使用 `vaultTotalAssets` 导致虚高

- **根因**：`accruedYield = vaultTotalAssets - totalPrincipal`。`vaultTotalAssets` 包含所有用户（含未 enrolled）的资产，而 `totalPrincipal` 只计 enrolled 用户，两者不可比，差值将未 enrolled 用户的本金也算入 yield。
- **修复**：改用 `vault.previewRedeem(enrolledVaultShares) - totalPrincipal`，仅计算 enrolled shares 的真实 yield。同时加 `totalPrincipal > 0n` 守卫，避免新轮次无人 enrolled 时 vault 持有上轮资产导致的极端偏差。

### NEW-FL-10 ✅ FIXED 奖池估算未按 Tier 拆分，把留存收益也算进奖池

- **根因**：Tier 1 留 90% yield、Tier 2 留 50%，前端将全部 yield 直接加到奖池估算，严重高估。
- **修复**：读取合约 `totalRetainWeightedPrincipal`（Σ principal_i × retainBps_i / BPS_DENOM），用公式：`poolYield = totalYield × (totalPrincipal - totalRetainWeightedPrincipal) / totalPrincipal`，只估算真正进入奖池的那部分 yield。

### NEW-FL-11 ✅ FIXED WinnerModal 用轮询检测开奖，SETTLED 状态窗口太短无法触发

- **根因**：`fulfillRandomWords()` 在同一笔 tx 中先 `SETTLED` 再 `_startNewRound()`，前端 10 秒轮询永远读不到 `SETTLED` 状态，弹窗从不触发。
- **修复**：改用 `useWatchContractEvent` 订阅 `DrawFulfilled` 事件，tx 上链即触发，奖金金额直接从事件参数读取（不依赖已清零的 `r.prizePool`）。

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
已修复:  31 项（合约 14 + 前端 13 + 部署/配置 4）
未修复:  12 项（均为 LOW/INFO 级别）
测试:    51/51 通过 ✅（+ 3 Solidity fuzz）
```

### 2026-04 新增修复（本次会话）

| ID | 类型 | 问题 |
|----|------|------|
| NEW-CH-2 (追加) | 合约 | Pull Pattern 重构：VRF 回调 / rollover 从 O(N) 改为 O(1) |
| NEW-CH-3 | 合约 | 跳过轮次的用户 vault shares 带入新轮导致奖池虚高 |
| NEW-CH-4 | 合约 | `r.prizePool` 结算后未归零，历史轮次读取值错误 |
| NEW-FM-1 (重新标记) | 前端 | approve tx 未等待上链即发 enterGame，首次必定失败 |
| NEW-FL-7 | 前端 | Dashboard 缺少 claimTicket / claimYield 入口 |
| NEW-FL-8 | 前端 | ABI 缺少 `enrolledVaultShares` 导致后续字段全部偏移 |
| NEW-FL-9 | 前端 | 奖池估算用 `vaultTotalAssets` 包含未 enrolled 用户本金 |
| NEW-FL-10 | 前端 | 奖池估算未按 Tier 拆分，留存收益也算进奖池 |
| NEW-FL-11 | 前端 | WinnerModal 轮询检测 SETTLED 状态，窗口太短永不触发 |
