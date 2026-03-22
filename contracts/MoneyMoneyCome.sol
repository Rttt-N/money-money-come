// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./TicketNFT.sol";
import "./YieldVault.sol";
import "./SquadRegistry.sol";

// ── Local interfaces instead of inheriting Chainlink; behavior unchanged ──

interface IVRFCoordinatorV2Plus {
    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16  requestConfirmations;
        uint32  callbackGasLimit;
        uint32  numWords;
        bytes   extraArgs;
    }
    function requestRandomWords(RandomWordsRequest calldata req) external returns (uint256);
}

// VRF consumer base — rawFulfillRandomWords is invoked by MockVRF
abstract contract VRFConsumerBaseV2Plus {
    address internal immutable vrfCoordinator;
    constructor(address _vrfCoordinator) { vrfCoordinator = _vrfCoordinator; }

    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        require(msg.sender == vrfCoordinator, "Only VRF coordinator");
        fulfillRandomWords(requestId, randomWords);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal virtual;
}

// Automation interface — checkUpkeep / performUpkeep
interface AutomationCompatibleInterface {
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory);
    function performUpkeep(bytes calldata) external;
}

// ── Main contract (same logic as reference implementation) ────────────────

contract MoneyMoneyCome is
    VRFConsumerBaseV2Plus,
    AutomationCompatibleInterface,
    ReentrancyGuard,
    Ownable
{
    using SafeERC20 for IERC20;

    // ── Structs ──────────────────────────────────────────────────────────────

    struct UserInfo {
        uint256 principal;
        uint256 vaultShares;
        uint256 tier1Amount;
        uint256 tier2Amount;
        uint256 tier3Amount;
        uint256 weightBps;
        uint256 loyaltyRounds;
        uint256 roundJoined;
    }

    struct TierConfig {
        uint256 yieldRetainBps;
        uint256 weightMultiplierBps;
    }

    enum RoundState { OPEN, LOCKED, DRAWING, SETTLED }

    struct RoundInfo {
        uint256    startTime;
        uint256    endTime;
        uint256    totalPrincipal;
        uint256    prizePool;
        uint256    totalWeight;
        RoundState state;
        address    winner;
    }

    // ── Constants ────────────────────────────────────────────────────────────

    uint256 public constant ROUND_DURATION    = 1;
    uint256 public constant BPS_DENOM         = 10_000;
    uint256 public constant LOYALTY_BONUS_BPS = 500;
    uint256 public constant MAX_LOYALTY_MULT  = 30_000;
    uint256 public constant MIN_DEPOSIT       = 10e6;

    bytes32 public immutable keyHash;
    uint256 public immutable subscriptionId;
    uint16  public constant REQUEST_CONFIRMATIONS = 3;
    uint32  public constant CALLBACK_GAS_LIMIT    = 500_000;
    uint32  public constant NUM_WORDS             = 1;

    // ── Tier configs ─────────────────────────────────────────────────────────

    mapping(uint8 => TierConfig) public tierConfigs;

    // ── External contracts ───────────────────────────────────────────────────

    IERC20        public immutable usdc;
    YieldVault    public immutable vault;
    TicketNFT     public immutable ticketNFT;
    SquadRegistry public immutable squadRegistry;
    IVRFCoordinatorV2Plus public immutable vrfCoord;

    // ── State ────────────────────────────────────────────────────────────────

    uint256 public currentRound;
    mapping(uint256 => RoundInfo)       public rounds;
    mapping(address => UserInfo)        public users;
    mapping(uint256 => address[])       private _roundParticipants;
    mapping(uint256 => uint256)         private _vrfRequestToRound;

    // ── Events ───────────────────────────────────────────────────────────────

    event GameEntered(address indexed user, uint256 indexed roundId, uint256 amount, uint8 tier);
    event Withdrawn(address indexed user, uint256 principal, uint256 interest, bool penalised);
    event DrawRequested(uint256 indexed roundId, uint256 requestId);
    event DrawFulfilled(uint256 indexed roundId, address indexed winner, uint256 prize);
    event RoundStarted(uint256 indexed roundId, uint256 startTime, uint256 endTime);

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _vault,
        address _ticketNFT,
        address _squadRegistry,
        address _vrfCoordinator,
        bytes32 _keyHash,
        uint256 _subscriptionId,
        address initialOwner
    )
        VRFConsumerBaseV2Plus(_vrfCoordinator)
        Ownable(initialOwner)
    {
        usdc           = IERC20(_usdc);
        vault          = YieldVault(_vault);
        ticketNFT      = TicketNFT(_ticketNFT);
        squadRegistry  = SquadRegistry(_squadRegistry);
        vrfCoord       = IVRFCoordinatorV2Plus(_vrfCoordinator);
        keyHash        = _keyHash;
        subscriptionId = _subscriptionId;

        tierConfigs[1] = TierConfig({ yieldRetainBps: 9000, weightMultiplierBps: 1000  });
        tierConfigs[2] = TierConfig({ yieldRetainBps: 5000, weightMultiplierBps: 5000  });
        tierConfigs[3] = TierConfig({ yieldRetainBps: 0,    weightMultiplierBps: 10000 });

        _startNewRound();
    }

    // ── enterGame ────────────────────────────────────────────────────────────

    function enterGame(uint256 amount, uint8 tier, uint256 squadId) external nonReentrant {
        require(amount >= MIN_DEPOSIT,                          "MMC: below minimum");
        require(tier >= 1 && tier <= 3,                        "MMC: invalid tier");
        require(rounds[currentRound].state == RoundState.OPEN, "MMC: round not open");

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        usdc.approve(address(vault), amount);
        uint256 shares = vault.deposit(amount, address(this));

        UserInfo storage u = users[msg.sender];
        bool alreadyInRound = (u.principal > 0 && u.roundJoined == currentRound);

        // Accumulate principal and shares (supports top-up)
        u.principal   += amount;
        u.vaultShares += shares;
        u.roundJoined  = currentRound;

        // Accumulate per-tier amount (each deposit keeps its own tier)
        if (tier == 1) u.tier1Amount += amount;
        else if (tier == 2) u.tier2Amount += amount;
        else u.tier3Amount += amount;

        // Recalculate blended weight from all tier amounts
        uint256 baseWeight  = _blendedBaseWeight(u);
        uint256 loyaltyMult = _loyaltyMultiplier(msg.sender);
        uint256 newWeight   = (baseWeight * loyaltyMult) / BPS_DENOM;

        if (alreadyInRound) {
            // Top-up: adjust round totals by delta
            rounds[currentRound].totalPrincipal += amount;
            rounds[currentRound].totalWeight    += (newWeight - u.weightBps);
        } else {
            // New participant this round (fresh or rollover)
            rounds[currentRound].totalPrincipal += amount;
            rounds[currentRound].totalWeight    += newWeight;
            _roundParticipants[currentRound].push(msg.sender);
        }

        u.weightBps = newWeight;

        if (squadId != 0) {
            require(squadRegistry.userSquad(msg.sender) == squadId, "MMC: not in that squad");
        }

        // Handle NFT: burn existing ticket for this round (from rollover or previous top-up), then mint updated one
        uint256 existingTicket = ticketNFT.userRoundTicket(msg.sender, currentRound);
        if (existingTicket != 0) {
            ticketNFT.burn(existingTicket);
        }

        uint256 weightBpsForNFT = u.principal > 0 ? newWeight * BPS_DENOM / u.principal : 0;
        ticketNFT.mint(msg.sender, currentRound, u.tier1Amount, u.tier2Amount, u.tier3Amount, weightBpsForNFT);

        emit GameEntered(msg.sender, currentRound, amount, tier);
    }

    // ── withdraw ─────────────────────────────────────────────────────────────

    function withdraw(uint256 amount) external nonReentrant {
        UserInfo storage u = users[msg.sender];
        require(u.principal > 0,       "MMC: no deposit");
        require(amount <= u.principal, "MMC: exceeds principal");

        RoundState state = rounds[currentRound].state;
        bool penalised   = (state == RoundState.LOCKED || state == RoundState.DRAWING);

        // Full exit: redeem all shares. Otherwise (shares * amount) / principal plus ERC4626
        // redeem rounding down can make received < amount while we still try to transfer amount → revert.
        uint256 sharesToRedeem = amount == u.principal
            ? u.vaultShares
            : (u.vaultShares * amount) / u.principal;
        uint256 received       = vault.redeem(sharesToRedeem, address(this), address(this));

        uint256 interest = received > amount ? received - amount : 0;
        uint256 toUser;

        if (penalised) {
            if (interest > 0) {
                rounds[currentRound].prizePool += interest;
                toUser = amount;
            } else {
                // No excess yield or rounding made received <= amount — pay only what was redeemed
                toUser = received;
            }
        } else {
            // No penalty: user receives full redemption proceeds (yield included; never transfer more than received)
            toUser = received;
        }

        // Proportional weight and tier amount removal.
        uint256 originalPrincipal = u.principal;
        uint256 weightToDeduct = (u.weightBps * amount) / originalPrincipal;

        // Proportional tier amount reduction
        uint256 t1Deduct = (u.tier1Amount * amount) / originalPrincipal;
        uint256 t2Deduct = (u.tier2Amount * amount) / originalPrincipal;
        uint256 t3Deduct = (u.tier3Amount * amount) / originalPrincipal;

        u.principal   -= amount;
        u.vaultShares -= sharesToRedeem;
        u.weightBps   -= weightToDeduct;
        u.tier1Amount -= t1Deduct;
        u.tier2Amount -= t2Deduct;
        u.tier3Amount -= t3Deduct;
        rounds[currentRound].totalPrincipal -= amount;
        rounds[currentRound].totalWeight    -= weightToDeduct;

        if (u.principal == 0) {
            // Explicit zero to eliminate rounding dust
            u.tier1Amount = 0;
            u.tier2Amount = 0;
            u.tier3Amount = 0;
            uint256 tokenId = ticketNFT.userRoundTicket(msg.sender, currentRound);
            if (tokenId != 0) ticketNFT.burn(tokenId);
            u.loyaltyRounds = 0;
        }

        usdc.safeTransfer(msg.sender, toUser);
        emit Withdrawn(msg.sender, amount, interest, penalised);
    }

    // ── Chainlink Automation ─────────────────────────────────────────────────

    function checkUpkeep(bytes calldata)
        external view override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        RoundInfo storage r = rounds[currentRound];
        upkeepNeeded = (
            block.timestamp >= r.endTime &&
            r.state == RoundState.OPEN &&
            _roundParticipants[currentRound].length > 0
        );
        performData = "";
    }

    function performUpkeep(bytes calldata) external override {
        RoundInfo storage r = rounds[currentRound];
        require(block.timestamp >= r.endTime, "MMC: round not ended");
        require(r.state == RoundState.OPEN,   "MMC: wrong state");

        r.state = RoundState.LOCKED;
        _harvestYield();

        IVRFCoordinatorV2Plus.RandomWordsRequest memory req = IVRFCoordinatorV2Plus.RandomWordsRequest({
            keyHash:             keyHash,
            subId:               subscriptionId,
            requestConfirmations: REQUEST_CONFIRMATIONS,
            callbackGasLimit:    CALLBACK_GAS_LIMIT,
            numWords:            NUM_WORDS,
            extraArgs:           ""
        });

        uint256 requestId = vrfCoord.requestRandomWords(req);
        _vrfRequestToRound[requestId] = currentRound;
        rounds[currentRound].state = RoundState.DRAWING;

        emit DrawRequested(currentRound, requestId);
    }

    // ── VRF callback ─────────────────────────────────────────────────────────

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords)
        internal override
    {
        uint256 roundId     = _vrfRequestToRound[requestId];
        RoundInfo storage r = rounds[roundId];
        require(r.state == RoundState.DRAWING, "MMC: wrong state");

        address[] storage participants = _roundParticipants[roundId];
        require(participants.length > 0, "MMC: no participants");

        uint256 rand = randomWords[0] % r.totalWeight;
        uint256 cumulative;
        address winner;

        for (uint256 i; i < participants.length; i++) {
            cumulative += users[participants[i]].weightBps;
            if (rand < cumulative) {
                winner = participants[i];
                break;
            }
        }
        if (winner == address(0)) winner = participants[participants.length - 1];

        r.winner = winner;
        uint256 prize = r.prizePool;

        uint256 squadId = squadRegistry.userSquad(winner);

        if (squadId != 0) {
            address[] memory members = squadRegistry.getSquadMembers(squadId);
            address[] memory addrs   = new address[](members.length);
            uint256[] memory weights = new uint256[](members.length);
            for (uint256 i; i < members.length; i++) {
                addrs[i]   = members[i];
                weights[i] = users[members[i]].weightBps;
            }
            (
                uint256 winnerAmount,
                address[] memory otherMembers,
                uint256[] memory otherAmounts
            ) = squadRegistry.calcSquadPrize(winner, prize, addrs, weights);

            if (winnerAmount > 0) usdc.safeTransfer(winner, winnerAmount);
            for (uint256 i; i < otherMembers.length; i++) {
                if (otherAmounts[i] > 0)
                    usdc.safeTransfer(otherMembers[i], otherAmounts[i]);
            }
        } else {
            if (prize > 0) usdc.safeTransfer(winner, prize);
        }

        for (uint256 i; i < participants.length; i++) {
            users[participants[i]].loyaltyRounds++;
        }

        r.state = RoundState.SETTLED;
        emit DrawFulfilled(roundId, winner, prize);
        _startNewRound();
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _startNewRound() internal {
        uint256 prevRound = currentRound;
        currentRound++;
        uint256 start = block.timestamp;
        rounds[currentRound] = RoundInfo({
            startTime:      start,
            endTime:        start + ROUND_DURATION,
            totalPrincipal: 0,
            prizePool:      0,
            totalWeight:    0,
            state:          RoundState.OPEN,
            winner:         address(0)
        });

        // ── Rollover: carry over participants who still have principal ────
        if (prevRound > 0) {
            address[] storage prev = _roundParticipants[prevRound];
            for (uint256 i; i < prev.length; i++) {
                address addr = prev[i];
                UserInfo storage u = users[addr];
                if (u.principal == 0) continue;

                // Recalculate blended weight with updated loyalty
                uint256 baseWeight  = _blendedBaseWeight(u);
                uint256 loyaltyMult = _loyaltyMultiplier(addr);
                uint256 newWeight   = (baseWeight * loyaltyMult) / BPS_DENOM;

                u.weightBps   = newWeight;
                u.roundJoined = currentRound;

                _roundParticipants[currentRound].push(addr);
                rounds[currentRound].totalPrincipal += u.principal;
                rounds[currentRound].totalWeight    += newWeight;

                // Mint new NFT ticket for the new round
                uint256 weightBpsForNFT = newWeight * BPS_DENOM / u.principal;
                ticketNFT.mint(addr, currentRound, u.tier1Amount, u.tier2Amount, u.tier3Amount, weightBpsForNFT);
            }
        }

        emit RoundStarted(currentRound, start, start + ROUND_DURATION);
    }

    function _harvestYield() internal {
        address[] storage participants = _roundParticipants[currentRound];
        RoundInfo storage r = rounds[currentRound];

        for (uint256 i; i < participants.length; i++) {
            address addr      = participants[i];
            UserInfo storage u = users[addr];
            if (u.principal == 0) continue;

            uint256 currentValue = vault.previewRedeem(u.vaultShares);
            uint256 interest     = currentValue > u.principal ? currentValue - u.principal : 0;
            if (interest == 0) continue;

            uint256 retainBps    = _blendedYieldRetainBps(u);
            uint256 userKeeps    = (interest * retainBps) / BPS_DENOM;
            uint256 toPool       = interest - userKeeps;

            // Redeem ALL interest shares so u.vaultShares only backs principal
            uint256 sharesToRedeem = vault.previewWithdraw(interest);
            if (sharesToRedeem > u.vaultShares) sharesToRedeem = u.vaultShares;
            vault.redeem(sharesToRedeem, address(this), address(this));
            u.vaultShares -= sharesToRedeem;

            // Send user's retained yield directly
            if (userKeeps > 0) {
                usdc.safeTransfer(addr, userKeeps);
            }

            r.prizePool += toPool;
        }
    }

    function _blendedBaseWeight(UserInfo storage u) internal view returns (uint256) {
        return (u.tier1Amount * tierConfigs[1].weightMultiplierBps
              + u.tier2Amount * tierConfigs[2].weightMultiplierBps
              + u.tier3Amount * tierConfigs[3].weightMultiplierBps) / BPS_DENOM;
    }

    function _blendedYieldRetainBps(UserInfo storage u) internal view returns (uint256) {
        if (u.principal == 0) return 0;
        return (u.tier1Amount * tierConfigs[1].yieldRetainBps
              + u.tier2Amount * tierConfigs[2].yieldRetainBps
              + u.tier3Amount * tierConfigs[3].yieldRetainBps) / u.principal;
    }

    function _loyaltyMultiplier(address user) internal view returns (uint256) {
        uint256 rounds_ = users[user].loyaltyRounds;
        uint256 mult    = BPS_DENOM + (rounds_ * LOYALTY_BONUS_BPS);
        return mult > MAX_LOYALTY_MULT ? MAX_LOYALTY_MULT : mult;
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getCurrentRoundInfo() external view returns (RoundInfo memory) {
        return rounds[currentRound];
    }

    function getUserInfo(address user) external view returns (UserInfo memory) {
        return users[user];
    }

    function getRoundParticipants(uint256 roundId) external view returns (address[] memory) {
        return _roundParticipants[roundId];
    }

    function getWinProbability(address user)
        external view returns (uint256 numerator, uint256 denominator)
    {
        numerator   = users[user].weightBps;
        denominator = rounds[currentRound].totalWeight;
    }
}