// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

interface IAToken {
    function balanceOf(address account) external view returns (uint256);
}

contract YieldVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    IAavePool public immutable aavePool;
    IAToken   public immutable aToken;

    constructor(
        IERC20 usdc,
        address _aavePool,
        address _aToken,
        address initialOwner
    )
        ERC4626(usdc)
        ERC20("MMC Yield Vault Share", "mmcVS")
        Ownable(initialOwner)
    {
        aavePool = IAavePool(_aavePool);
        aToken   = IAToken(_aToken);
        usdc.approve(_aavePool, type(uint256).max);
    }

    function totalAssets() public view override returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal override
    {
        super._deposit(caller, receiver, assets, shares);
        aavePool.supply(asset(), assets, address(this), 0);
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal override
    {
        aavePool.withdraw(asset(), assets, address(this));
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    function deposit(uint256 assets, address receiver) public override onlyOwner returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        public override onlyOwner returns (uint256)
    {
        return super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public override onlyOwner returns (uint256)
    {
        return super.redeem(shares, receiver, owner_);
    }
}