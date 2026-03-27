// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

// 模拟 aToken，余额会随时间自动增加（模拟利息）
contract MockAToken {
    mapping(address => uint256) private _balances;
    mapping(address => uint256) private _depositTime;
    address public underlying;
    uint256 public yieldRateBps; // 每分钟利率 (bps), 如 200 = 2%/min

    constructor(address _underlying) { underlying = _underlying; }

    /// @notice 设置自动生息利率（仅测试用）
    function setYieldRate(uint256 _rateBps) external {
        yieldRateBps = _rateBps;
    }

    function setBalance(address account, uint256 amount) external {
        _balances[account] = amount;
        _depositTime[account] = block.timestamp;
    }

    function balanceOf(address account) external view returns (uint256) {
        uint256 base = _balances[account];
        if (base == 0 || yieldRateBps == 0) return base;
        uint256 elapsed = block.timestamp - _depositTime[account];
        uint256 yieldAmount = (base * elapsed * yieldRateBps) / (60 * 10000);
        return base + yieldAmount;
    }

    // 手动注入额外利息（兼容旧用法）
    function simulateYield(address account, uint256 extraAmount) external {
        // 先实现已有时间收益，再叠加额外金额
        uint256 current = this.balanceOf(account);
        _balances[account] = current + extraAmount;
        _depositTime[account] = block.timestamp;
    }
}

contract MockAavePool {
    mapping(address => uint256) public supplied;   // asset → amount
    MockAToken public aToken;

    constructor(address _underlying) {
        aToken = new MockAToken(_underlying);
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        supplied[asset] += amount;
        aToken.setBalance(onBehalfOf, aToken.balanceOf(onBehalfOf) + amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        // 自动 mint 差额以覆盖利息产生的 "虚拟" USDC
        uint256 poolBalance = IERC20(asset).balanceOf(address(this));
        if (poolBalance < amount) {
            IMintable(asset).mint(address(this), amount - poolBalance);
        }
        IERC20(asset).transfer(to, amount);
        // 同步扣减 caller（即 YieldVault）的 aToken 余额，保持 totalAssets() 与实际一致
        uint256 current = aToken.balanceOf(msg.sender);
        aToken.setBalance(msg.sender, current > amount ? current - amount : 0);
        return amount;
    }
}
