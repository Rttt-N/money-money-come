// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// 模拟 aToken，余额会自动增加（模拟利息）
contract MockAToken {
    mapping(address => uint256) private _balances;
    address public underlying;

    constructor(address _underlying) { underlying = _underlying; }

    function setBalance(address account, uint256 amount) external {
        _balances[account] = amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    // 测试时手动调这个模拟利息累积
    function simulateYield(address account, uint256 extraAmount) external {
        _balances[account] += extraAmount;
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
        IERC20(asset).transfer(to, amount);
        // 同步扣减 caller（即 YieldVault）的 aToken 余额，保持 totalAssets() 与实际一致
        uint256 current = aToken.balanceOf(msg.sender);
        aToken.setBalance(msg.sender, current > amount ? current - amount : 0);
        return amount;
    }
}