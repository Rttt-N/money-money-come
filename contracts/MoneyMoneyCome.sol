// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./TicketNFT.sol";
import "./YieldVault.sol";
import "./SquadRegistry.sol";

// ── Chainlink interfaces (local copies, no external package inheritance) ───────

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

// VRF consumer base — rawFulfillRandomWords is invoked by MockVRF / Chainlink coordinator
abstract contract VRFConsumerBaseV2Plus {
    address internal immutable vrfCoordinator;
    constructor(address _vrfCoordinator) { vrfCoordinator = _vrfCoordinator; }

    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        require(msg.sender == vrfCoordinator, "Only VRF coordinator");
        fulfillRandomWords(requestId, randomWords);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal virtual;
}

interface AutomationCompatibleInterface {
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory);
    function performUpkeep(bytes calldata) external;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MoneyMoneyCome — Pull-Pattern Refactor
// ───────────────────────────────────────────────────────────────────────────────
//
//  ROOT CAUSE OF ORIGINAL BUGS (fixed here):
//
//  [Bug 1] VRF callback Out-of-Gas → contract stuck in DRAWING forever
//    Old:  fulfillRandomWords() called _startNewRound(), which looped N users
//          and called ticketNFT.mint() for each (~50k gas × 100 users = 5M gas
//          > callbackGasLimit of 1M gas → revert → DRAWING state never exits).
//    Fix:  _startNewRound() is now O(1) — just initialises a RoundInfo struct.
//          NFT minting moved to claimTicket(), paid by the user themselves.
//
//  [Bug 2] Automation performUpkeep Out-of-Gas → Automation nodes stop triggering
//    Old:  performUpkeep() called _harvestYield(), which looped N users calling
//          vault.previewRedeem / vault.redeem per user (hundreds of k gas × N).
//    Fix:  _harvestYieldGlobal() is O(1) — one vault read, one vault redeem,
//          using a MasterChef-style accumulator (totalRetainWeightedPrincipal)
//          to split yield between pool and users without iterating participants.
//
//  ARCHITECTURE CHANGE: Push → Pull
//
//  BEFORE (Push):
//    Protocol iterates all users and pushes state updates at round end.
//    Gas cost = O(N × cost_per_user) — breaks as N grows.
//
//  AFTER (Pull):
//    Protocol only performs O(1) global operations at round transitions.
//    Users pull their own state updates (rollover, NFT, yield) individually.
//    Gas cost per protocol action = O(1) regardless of N.
//
//  New user-facing functions:
//    claimTicket()          — roll over to current round, update loyalty, mint NFT
//    claimYield(roundId)    — claim retained yield from a settled round
//
// ═══════════════════════════════════════════════════════════════════════════════

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
        uint256 roundJoined;   // last round the user was enrolled in (or attempted rollover)
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
        uint256    enrolledVaultShares; // sum of vault shares for enrolled participants only
                                        // (non-enrolled users' shares are excluded)
        uint256    prizePool;
        uint256    totalWeight;
        RoundState state;
        address    winner;
    }

    // ── Constants ────────────────────────────────────────────────────────────

    uint256 public          roundDuration      = 7 days;
    uint256 public constant BPS_DENOM         = 10_000;
    uint256 public constant LOYALTY_BONUS_BPS = 500;
    uint256 public constant MAX_LOYALTY_MULT  = 30_000;
    uint256 public constant MIN_DEPOSIT       = 10e6;

    bytes32 public immutable keyHash;
    uint256 public immutable subscriptionId;
    uint16  public constant  REQUEST_CONFIRMATIONS = 3;

    // Reduced from 1_000_000: VRF callback no longer runs O(N) loops.
    // O(N≤100) weighted selection ≈ 210k gas; O(10) squad ≈ 80k gas → 400k is safe.
    uint32  public           callbackGasLimit  = 400_000;
    uint32  public constant  NUM_WORDS         = 1;
    uint256 public constant  MAX_PARTICIPANTS  = 100;

    // ── Tier configs ─────────────────────────────────────────────────────────

    mapping(uint8 => TierConfig) public tierConfigs;

    // ── External contracts ───────────────────────────────────────────────────

    IERC20        public immutable usdc;
    YieldVault    public immutable vault;
    TicketNFT     public immutable ticketNFT;
    SquadRegistry public immutable squadRegistry;
    IVRFCoordinatorV2Plus public immutable vrfCoord;

    // ── Round / User state ───────────────────────────────────────────────────

    uint256 public currentRound;
    mapping(uint256 => RoundInfo)  public rounds;
    mapping(address => UserInfo)   public users;
    mapping(uint256 => address[])  private _roundParticipants;
    mapping(uint256 => uint256)    private _vrfRequestToRound;
    mapping(address => uint256)    public  pendingWithdrawals; // H-1: pull payments

    // ── Pull-pattern: MasterChef-style O(1) yield accumulator ────────────────
    //
    //  Tracks: sum_i( principal_i × blendedRetainBps_i ) for all participants
    //          enrolled in the CURRENT round.
    //
    //  Updated O(1) on every enterGame / withdraw / claimTicket.
    //  Reset to 0 at the start of each new round (_startNewRound).
    //
    //  At harvest time (performUpkeep), used to split total yield in O(1):
    //    toUsers = totalYield × totalRetainWeightedPrincipal / (totalPrincipal × BPS_DENOM)
    //    toPool  = totalYield − toUsers
    //  No user iteration needed.
    uint256 public totalRetainWeightedPrincipal;

    // ── Pull-pattern: per-round harvest data (written once, read lazily) ──────

    // Share factor after yield harvest: (enrolledShares - redeemedShares) × 1e18 / enrolledShares
    //   0     → harvest not yet run (should not occur for SETTLED rounds)
    //   1e18  → harvest ran but no yield (shares unchanged)
    //   <1e18 → yield was harvested; user shares are reduced by this factor
    //
    // Allows O(1) per-user share adjustment on next withdraw/rollover,
    // without iterating all users.
    mapping(uint256 => uint256) public roundHarvestShareFactor;

    // Total yield rate: actualReceived × 1e18 / totalEnrolledPrincipal
    // Written once in _harvestYieldGlobal(). Used in claimYield():
    //   userRetained = userPrincipal × rate / 1e18 × userRetainBps / BPS_DENOM
    mapping(uint256 => uint256) public roundYieldPerPrincipal;

    // ── Pull-pattern: per-user enrollment snapshots ──────────────────────────

    // Snapshot of user's principal at their last enterGame / rollover for this round.
    // Required for claimYield() — user.principal may have changed in later rounds.
    mapping(uint256 => mapping(address => uint256)) private _userRoundPrincipal;

    // Snapshot of user's blended yield-retain bps at enrollment time.
    mapping(uint256 => mapping(address => uint256)) private _userRoundRetainBps;

    // True once user has claimed (or forfeited) their retained yield for a round.
    mapping(uint256 => mapping(address => bool)) public userYieldClaimed;

    // Tracks which round's harvest-share-factor has already been applied to u.vaultShares.
    // Prevents double-application on repeated withdraw calls in the same round.
    mapping(address => uint256) private _userHarvestAdjustedRound;

    // ── Automation forwarder ─────────────────────────────────────────────────

    address public automationForwarder;

    // ── Events ───────────────────────────────────────────────────────────────

    event GameEntered(address indexed user, uint256 indexed roundId, uint256 amount, uint8 tier);
    event Withdrawn(address indexed user, uint256 principal, uint256 interest, bool penalised);
    event DrawRequested(uint256 indexed roundId, uint256 requestId);
    event DrawFulfilled(uint256 indexed roundId, address indexed winner, uint256 prize);
    event RoundStarted(uint256 indexed roundId, uint256 startTime, uint256 endTime);
    event PrizeCredited(address indexed recipient, uint256 amount);
    event PrizeClaimed(address indexed recipient, uint256 amount);
    event TicketClaimed(address indexed user, uint256 indexed roundId);
    event YieldClaimed(address indexed user, uint256 indexed roundId, uint256 amount);

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
        require(block.timestamp < rounds[currentRound].endTime,  "MMC: round time expired");

        // Auto-rollover: if user has principal from a prior settled round, process it now.
        // Saves the user a separate claimTicket() call when actively depositing.
        _processRollover(msg.sender);

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        usdc.forceApprove(address(vault), amount);
        uint256 shares = vault.deposit(amount, address(this));

        UserInfo storage u = users[msg.sender];
        bool alreadyInRound = (u.roundJoined == currentRound);

        // ── Update MasterChef accumulator (O(1)) ──────────────────────────
        // Remove old contribution before modifying user state, then re-add after.
        if (alreadyInRound && u.principal > 0) {
            totalRetainWeightedPrincipal -= u.principal * _blendedYieldRetainBps(u) / BPS_DENOM;
        }

        // Update user balances
        u.principal   += amount;
        u.vaultShares += shares;
        u.roundJoined  = currentRound;
        if (tier == 1)      u.tier1Amount += amount;
        else if (tier == 2) u.tier2Amount += amount;
        else                u.tier3Amount += amount;

        // Re-add updated contribution to accumulator
        totalRetainWeightedPrincipal += u.principal * _blendedYieldRetainBps(u) / BPS_DENOM;

        // Recalculate blended weight
        uint256 baseWeight  = _blendedBaseWeight(u);
        uint256 loyaltyMult = _loyaltyMultiplier(msg.sender);
        uint256 newWeight   = (baseWeight * loyaltyMult) / BPS_DENOM;

        if (alreadyInRound) {
            // Top-up: adjust round totals by delta
            rounds[currentRound].totalPrincipal      += amount;
            rounds[currentRound].enrolledVaultShares += shares;
            rounds[currentRound].totalWeight         += (newWeight - u.weightBps);
        } else {
            // New participant this round
            require(_roundParticipants[currentRound].length < MAX_PARTICIPANTS, "MMC: round full");
            rounds[currentRound].totalPrincipal      += amount;
            rounds[currentRound].enrolledVaultShares += shares;
            rounds[currentRound].totalWeight         += newWeight;
            _roundParticipants[currentRound].push(msg.sender);
        }
        u.weightBps = newWeight;

        // Enrollment snapshot — used by claimYield() after round settles
        _userRoundPrincipal[currentRound][msg.sender] = u.principal;
        _userRoundRetainBps[currentRound][msg.sender] = _blendedYieldRetainBps(u);

        if (squadId != 0) {
            require(squadRegistry.userSquad(msg.sender) == squadId, "MMC: not in that squad");
        }

        // NFT: burn existing ticket for this round (top-up), mint updated one
        uint256 existingTicket = ticketNFT.userRoundTicket(msg.sender, currentRound);
        if (existingTicket != 0) ticketNFT.burn(existingTicket);
        uint256 wbps = u.principal > 0 ? newWeight * BPS_DENOM / u.principal : 0;
        ticketNFT.mint(msg.sender, currentRound, u.tier1Amount, u.tier2Amount, u.tier3Amount, wbps);

        emit GameEntered(msg.sender, currentRound, amount, tier);
    }

    // ── claimTicket — Pull-pattern rollover (replaces O(N) loop) ─────────────
    //
    //  OLD: _startNewRound() pushed rollover + NFT mint to every participant
    //       inside the VRF callback → O(N × 50k gas) → Out-of-Gas DoS.
    //
    //  NEW: Users self-enroll by calling claimTicket(). Each call is O(1).
    //       The protocol pays zero gas for rollover regardless of how many
    //       users are rolling over.
    function claimTicket() external nonReentrant {
        require(users[msg.sender].principal > 0, "MMC: no deposit");
        _processRollover(msg.sender);
        emit TicketClaimed(msg.sender, currentRound);
    }

    // ── _processRollover — O(1) per user ─────────────────────────────────────
    //
    //  Handles:
    //    1. Loyalty increment (only if user was enrolled in previous round)
    //    2. Vault share adjustment using harvest factor (O(1), no vault call)
    //    3. Weight recalculation with updated loyalty
    //    4. Enrollment in current round (if OPEN and not full)
    //    5. NFT mint for new round
    //
    //  Key correctness invariants:
    //    - u.roundJoined is updated unconditionally (prevents double-processing
    //      of loyalty/shares if claimTicket is called repeatedly across rounds)
    //    - Loyalty and share adjustment are gated on _userRoundPrincipal > 0
    //      (only rewards actual participation, not failed enrollment attempts)
    function _processRollover(address user) internal {
        UserInfo storage u = users[user];
        if (u.principal == 0) return;
        if (u.roundJoined == currentRound) return; // already enrolled or already processed

        uint256 prevRound = u.roundJoined;

        // Only proceed if the user's previous round has fully settled
        if (rounds[prevRound].state != RoundState.SETTLED) return;

        bool wasEnrolled = _userRoundPrincipal[prevRound][user] > 0;

        // 1. Loyalty: only reward participation in the draw (wasEnrolled = true)
        if (wasEnrolled) {
            u.loyaltyRounds++;
        }

        // 2. Vault share adjustment using the harvest factor (O(1))
        //
        //    After _harvestYieldGlobal(), enrolled vault shares are proportionally
        //    reduced. We apply the same reduction to each user's individual share
        //    count lazily — no iteration, no vault call.
        //
        //    effectiveShares = u.vaultShares × harvestFactor / 1e18
        //
        //    _userHarvestAdjustedRound prevents double-application if the user
        //    partially withdrew (which already adjusted their shares) before rolling over.
        if (wasEnrolled && _userHarvestAdjustedRound[user] != prevRound) {
            uint256 factor = roundHarvestShareFactor[prevRound];
            if (factor != 0 && factor != 1e18) {
                u.vaultShares = u.vaultShares * factor / 1e18;
            }
            _userHarvestAdjustedRound[user] = prevRound;
        }

        // 3. Recalculate weight with updated loyalty
        uint256 baseWeight  = _blendedBaseWeight(u);
        uint256 loyaltyMult = _loyaltyMultiplier(user);
        uint256 newWeight   = (baseWeight * loyaltyMult) / BPS_DENOM;
        u.weightBps = newWeight;

        // Mark rollover as processed for this round (prevents double loyalty on retry)
        u.roundJoined = currentRound;

        // Bug fix: if the user skipped one or more intermediate rounds (either they
        // were never enrolled in prevRound, or currentRound > prevRound+1), their vault
        // shares accumulated yield outside of any _harvestYieldGlobal() sweep.
        // Enrolling those over-valued shares inflates enrolledVaultShares > totalPrincipal,
        // causing _harvestYieldGlobal() to over-count yield and inflate the prize pool.
        //
        // Fix: redeem the accumulated excess yield now so u.vaultShares represents exactly
        // u.principal before enrollment. The user keeps 100% of the skipped-round yield
        // (they weren't contributing to any prize pool during that period).
        bool skippedRounds = !wasEnrolled || currentRound > prevRound + 1;
        if (skippedRounds && u.vaultShares > 0) {
            uint256 currentValue = vault.previewRedeem(u.vaultShares);
            if (currentValue > u.principal) {
                uint256 accYield    = currentValue - u.principal;
                uint256 yieldShares = vault.previewWithdraw(accYield);
                if (yieldShares > 0 && yieldShares <= u.vaultShares) {
                    uint256 received = vault.redeem(yieldShares, address(this), address(this));
                    u.vaultShares -= yieldShares;
                    if (received > 0) pendingWithdrawals[user] += received;
                }
            }
        }

        // 4. Enroll in current round (only if OPEN and not expired/full)
        RoundInfo storage r = rounds[currentRound];
        if (r.state != RoundState.OPEN || block.timestamp >= r.endTime) return;
        if (_roundParticipants[currentRound].length >= MAX_PARTICIPANTS) return;

        _roundParticipants[currentRound].push(user);
        r.totalPrincipal      += u.principal;
        r.enrolledVaultShares += u.vaultShares;
        r.totalWeight         += newWeight;

        // Rebuild accumulator contribution for this user in the new round
        totalRetainWeightedPrincipal += u.principal * _blendedYieldRetainBps(u) / BPS_DENOM;

        // Enrollment snapshot for lazy yield claim
        _userRoundPrincipal[currentRound][user] = u.principal;
        _userRoundRetainBps[currentRound][user] = _blendedYieldRetainBps(u);

        // 5. Mint NFT for new round
        uint256 wbps = newWeight * BPS_DENOM / u.principal;
        ticketNFT.mint(user, currentRound, u.tier1Amount, u.tier2Amount, u.tier3Amount, wbps);
    }

    // ── claimYield — Pull-pattern yield distribution (replaces push in _harvestYield) ──
    //
    //  OLD: _harvestYield() iterated all N users, called vault.redeem() per user,
    //       and pushed yield to pendingWithdrawals → O(N × vault_call) DoS.
    //
    //  NEW: _harvestYieldGlobal() redeems ALL yield in a single vault call,
    //       sets roundYieldPerPrincipal (a global rate), and keeps the USDC
    //       in the contract. Users pull their individual share by calling
    //       claimYield(roundId) after the round settles. Each call is O(1).
    function claimYield(uint256 roundId) external nonReentrant {
        require(rounds[roundId].state == RoundState.SETTLED, "MMC: round not settled");
        require(!userYieldClaimed[roundId][msg.sender],       "MMC: yield already claimed");

        uint256 userPrincipal = _userRoundPrincipal[roundId][msg.sender];
        require(userPrincipal > 0, "MMC: not enrolled in round");

        // Mark claimed before transfer (CEI pattern)
        userYieldClaimed[roundId][msg.sender] = true;

        uint256 yieldRate = roundYieldPerPrincipal[roundId];
        if (yieldRate == 0) return; // no yield this round

        uint256 userRetainBps = _userRoundRetainBps[roundId][msg.sender];
        // userRetained = principal × (totalYield / totalPrincipal) × retainBps
        uint256 userRetained  = userPrincipal * yieldRate / 1e18 * userRetainBps / BPS_DENOM;

        if (userRetained > 0) {
            pendingWithdrawals[msg.sender] += userRetained;
            emit YieldClaimed(msg.sender, roundId, userRetained);
        }
    }

    // ── withdraw ─────────────────────────────────────────────────────────────

    function withdraw(uint256 amount) external nonReentrant {
        UserInfo storage u = users[msg.sender];
        require(u.principal > 0,       "MMC: no deposit");
        require(amount <= u.principal, "MMC: exceeds principal");

        RoundState state = rounds[currentRound].state;
        require(state != RoundState.DRAWING, "MMC: draw in progress"); // NEW-CM-2

        bool penalised = (state == RoundState.LOCKED);

        // ── Apply harvest factor once per round (O(1)) ──────────────────────
        //
        //  After _harvestYieldGlobal() runs, enrolled shares are reduced by
        //  roundHarvestShareFactor. We apply this lazily to u.vaultShares here.
        //  _userHarvestAdjustedRound prevents double-application on multiple
        //  withdrawals in the same post-harvest window.
        if (u.roundJoined == currentRound &&
            _userHarvestAdjustedRound[msg.sender] != currentRound) {
            uint256 factor = roundHarvestShareFactor[currentRound];
            if (factor != 0 && factor != 1e18) {
                u.vaultShares = u.vaultShares * factor / 1e18;
            }
            _userHarvestAdjustedRound[msg.sender] = currentRound;
        }

        uint256 sharesToRedeem = amount == u.principal
            ? u.vaultShares
            : (u.vaultShares * amount) / u.principal;
        uint256 received = vault.redeem(sharesToRedeem, address(this), address(this));

        uint256 interest = received > amount ? received - amount : 0;
        uint256 toUser;

        if (penalised) {
            // LOCKED-state withdrawal: forfeit retained yield claim for this round.
            //
            // In the original design, withdrawing during LOCKED forfeited your yield
            // (it went to the prize pool). In the pull model, yield was already
            // globally harvested. We replicate the penalty by:
            //   1. Marking userYieldClaimed = true (blocking future claimYield call)
            //   2. Adding the forfeited retained amount back to the prize pool
            if (!userYieldClaimed[currentRound][msg.sender]) {
                userYieldClaimed[currentRound][msg.sender] = true;
                uint256 yieldRate = roundYieldPerPrincipal[currentRound];
                if (yieldRate > 0) {
                    uint256 pSnap = _userRoundPrincipal[currentRound][msg.sender];
                    uint256 rBps  = _userRoundRetainBps[currentRound][msg.sender];
                    uint256 forfeited = pSnap * yieldRate / 1e18 * rBps / BPS_DENOM;
                    rounds[currentRound].prizePool += forfeited;
                }
            }
            if (interest > 0) {
                rounds[currentRound].prizePool += interest;
                toUser = amount;
            } else {
                toUser = received;
            }
        } else {
            toUser = received;
        }

        // ── Update accounting ────────────────────────────────────────────────

        bool enrolledInCurrentRound = (u.roundJoined == currentRound);

        // Remove old accumulator contribution before modifying user state
        if (enrolledInCurrentRound && u.principal > 0) {
            totalRetainWeightedPrincipal -= u.principal * _blendedYieldRetainBps(u) / BPS_DENOM;
        }

        uint256 originalPrincipal = u.principal;
        uint256 weightToDeduct    = (u.weightBps   * amount) / originalPrincipal;
        uint256 t1Deduct          = (u.tier1Amount * amount) / originalPrincipal;
        uint256 t2Deduct          = (u.tier2Amount * amount) / originalPrincipal;
        uint256 t3Deduct          = (u.tier3Amount * amount) / originalPrincipal;

        u.principal   -= amount;
        u.vaultShares -= sharesToRedeem;
        u.weightBps   -= weightToDeduct;
        u.tier1Amount -= t1Deduct;
        u.tier2Amount -= t2Deduct;
        u.tier3Amount -= t3Deduct;

        if (enrolledInCurrentRound) {
            rounds[currentRound].totalPrincipal      -= amount;
            rounds[currentRound].enrolledVaultShares -= sharesToRedeem;
            rounds[currentRound].totalWeight         -= weightToDeduct;

            // Re-add updated contribution if user still has principal
            if (u.principal > 0) {
                totalRetainWeightedPrincipal += u.principal * _blendedYieldRetainBps(u) / BPS_DENOM;
            }
        }

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

    // ── Admin setters ─────────────────────────────────────────────────────────

    /// @notice Update round duration. Also updates current round endTime if still OPEN.
    function setRoundDuration(uint256 newDuration) external onlyOwner {
        require(newDuration >= 1, "MMC: duration too short");
        roundDuration = newDuration;
        RoundInfo storage r = rounds[currentRound];
        if (r.state == RoundState.OPEN) {
            r.endTime = r.startTime + newDuration;
        }
    }

    /// @notice Update VRF callback gas limit.
    function setCallbackGasLimit(uint32 newLimit) external onlyOwner {
        require(newLimit >= 100_000, "MMC: gas limit too low");
        callbackGasLimit = newLimit;
    }

    /// @notice Set the Chainlink Automation forwarder. address(0) = anyone can call.
    function setAutomationForwarder(address forwarder) external onlyOwner {
        automationForwarder = forwarder;
    }

    /// @notice Emergency: force-settle a stuck DRAWING/LOCKED round with no winner.
    function emergencyReset() external onlyOwner {
        RoundInfo storage r = rounds[currentRound];
        require(
            r.state == RoundState.DRAWING || r.state == RoundState.LOCKED,
            "MMC: round not stuck"
        );
        // Ensure harvest factor is set (harvest may have been skipped for stuck rounds)
        if (roundHarvestShareFactor[currentRound] == 0) {
            roundHarvestShareFactor[currentRound] = 1e18;
        }
        r.state  = RoundState.SETTLED;
        r.winner = address(0);
        emit DrawFulfilled(currentRound, address(0), 0);
        _startNewRound();
    }

    // ── claimPrize (pull payment for winners and yield) ───────────────────────

    function claimPrize() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "MMC: nothing to claim");
        pendingWithdrawals[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit PrizeClaimed(msg.sender, amount);
    }

    // ── Chainlink Automation ─────────────────────────────────────────────────

    /// @notice O(1): checks time + state only. No participant iteration.
    ///         Round ends on schedule regardless of how many users have rolled over.
    function checkUpkeep(bytes calldata)
        external view override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        RoundInfo storage r = rounds[currentRound];
        upkeepNeeded = (block.timestamp >= r.endTime && r.state == RoundState.OPEN);
        performData  = "";
    }

    /// @notice Locks the round, runs O(1) yield harvest, then requests VRF.
    ///
    ///  OLD: called _harvestYield() which looped N users × vault.redeem()
    ///       → O(N × 200k gas) → Automation nodes reject at N ≈ 25+ users.
    ///  NEW: calls _harvestYieldGlobal() which is O(1) regardless of N.
    function performUpkeep(bytes calldata) external override {
        require(
            automationForwarder == address(0)
                || msg.sender == automationForwarder
                || msg.sender == owner(),
            "MMC: not authorized"
        );

        RoundInfo storage r = rounds[currentRound];
        require(block.timestamp >= r.endTime, "MMC: round not ended");
        require(r.state == RoundState.OPEN,   "MMC: wrong state");

        r.state = RoundState.LOCKED;

        // O(1) global yield harvest — the key fix for the Automation DoS bug
        _harvestYieldGlobal();

        if (_roundParticipants[currentRound].length == 0) {
            // No enrolled participants: settle without VRF, carry prize forward
            r.state  = RoundState.SETTLED;
            r.winner = address(0);
            emit DrawFulfilled(currentRound, address(0), 0);
            uint256 carry = r.prizePool;
            r.prizePool = 0;
            _startNewRound();
            if (carry > 0) rounds[currentRound].prizePool += carry;
            return;
        }

        // VRF V2.5: VRFV2PlusClient.EXTRA_ARGS_V1_TAG, nativePayment=false (LINK)
        bytes memory vrfExtraArgs = abi.encodePacked(
            bytes4(keccak256("VRF ExtraArgsV1")),
            abi.encode(false)
        );

        uint256 requestId = vrfCoord.requestRandomWords(
            IVRFCoordinatorV2Plus.RandomWordsRequest({
                keyHash:              keyHash,
                subId:                subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit:     callbackGasLimit,
                numWords:             NUM_WORDS,
                extraArgs:            vrfExtraArgs
            })
        );
        _vrfRequestToRound[requestId] = currentRound;
        rounds[currentRound].state    = RoundState.DRAWING;

        emit DrawRequested(currentRound, requestId);
    }

    // ── VRF callback ─────────────────────────────────────────────────────────
    //
    //  Gas budget analysis (with callbackGasLimit = 400_000):
    //    Weighted selection loop:  N≤100 × ~2,100 gas (SLOAD) = ~210k gas
    //    Squad prize distribution: ≤10 members × ~8,000 gas   =  ~80k gas
    //    _startNewRound() (O(1)):                              =   ~5k gas
    //    Overhead + safety margin:                             =  ~60k gas
    //    Total estimate:                                       ≈ 355k gas ✓
    //
    //  OLD: also ran O(N) loyalty update loop + O(N) NFT mints = 5M+ gas → stuck.
    //  NEW: loyalty updated lazily in _processRollover() when user calls claimTicket().

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords)
        internal override
    {
        uint256 roundId     = _vrfRequestToRound[requestId];
        RoundInfo storage r = rounds[roundId];
        require(r.state == RoundState.DRAWING, "MMC: wrong state");

        address[] storage participants = _roundParticipants[roundId];
        require(participants.length > 0, "MMC: no participants");

        // Guard: all users withdrew during DRAWING window (H-2)
        if (r.totalWeight == 0) {
            r.state = RoundState.SETTLED;
            emit DrawFulfilled(roundId, address(0), r.prizePool);
            uint256 carry = r.prizePool;
            r.prizePool = 0;
            _startNewRound();
            if (carry > 0) rounds[currentRound].prizePool += carry;
            return;
        }

        // Weighted random selection: O(N≤100), each step is one cheap SLOAD
        uint256 rand = randomWords[0] % r.totalWeight;
        uint256 cumulative;
        address winner;
        for (uint256 i; i < participants.length; i++) {
            cumulative += users[participants[i]].weightBps;
            if (rand < cumulative) { winner = participants[i]; break; }
        }
        if (winner == address(0)) winner = participants[participants.length - 1];

        r.winner = winner;
        uint256 prize = r.prizePool;

        // Squad prize distribution: O(squad_size ≤ 10) — bounded, safe in VRF callback
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

            if (winnerAmount > 0) {
                pendingWithdrawals[winner] += winnerAmount;
                emit PrizeCredited(winner, winnerAmount);
            }
            for (uint256 i; i < otherMembers.length; i++) {
                if (otherAmounts[i] > 0) {
                    pendingWithdrawals[otherMembers[i]] += otherAmounts[i];
                    emit PrizeCredited(otherMembers[i], otherAmounts[i]);
                }
            }
        } else {
            if (prize > 0) {
                pendingWithdrawals[winner] += prize;
                emit PrizeCredited(winner, prize);
            }
        }

        // ── REMOVED: O(N) loyalty update loop ──
        // Was: for (i < participants.length) users[i].loyaltyRounds++
        // Now: loyalty is incremented lazily per-user in _processRollover()
        //      when the user calls claimTicket() for the next round.

        r.state     = RoundState.SETTLED;
        r.prizePool = 0;
        emit DrawFulfilled(roundId, winner, prize);

        // O(1): just initialises a new RoundInfo struct — no participant loop, no NFT minting
        _startNewRound();
    }

    // ── _harvestYieldGlobal — O(1) MasterChef-style harvest ──────────────────
    //
    //  OLD _harvestYield(): for (i < N) { vault.previewRedeem(u[i].shares); vault.redeem(...) }
    //    → O(N) vault calls, O(N × ~200k gas) → Automation DoS at N ≈ 25+
    //
    //  NEW _harvestYieldGlobal():
    //    Step 1: vault.previewRedeem(totalEnrolledShares)  — one read
    //    Step 2: split = f(totalRetainWeightedPrincipal)   — O(1) arithmetic
    //    Step 3: vault.redeem(yieldShares, ...)            — one write
    //    Total vault interactions: 2 regardless of N.
    //
    //  The retained USDC sits in the contract balance. Users claim their individual
    //  share lazily via claimYield(roundId) — each call is O(1).
    //
    //  Vault share accounting:
    //    After redeeming yield shares, enrolled users' effective shares are
    //    proportionally reduced. We store roundHarvestShareFactor so each user's
    //    adjustment can be applied in O(1) on their next withdraw/rollover call.
    //
    function _harvestYieldGlobal() internal {
        RoundInfo storage r    = rounds[currentRound];
        uint256 enrolledShares = r.enrolledVaultShares;
        uint256 totalPrincipal = r.totalPrincipal;

        if (enrolledShares == 0 || totalPrincipal == 0) {
            roundHarvestShareFactor[currentRound] = 1e18; // no shares → no adjustment
            return;
        }

        // Single vault read: current value of all enrolled shares (O(1))
        uint256 currentValue = vault.previewRedeem(enrolledShares);
        if (currentValue <= totalPrincipal) {
            roundHarvestShareFactor[currentRound] = 1e18; // no yield → shares unchanged
            return;
        }

        uint256 totalYield = currentValue - totalPrincipal;

        // O(1) split using MasterChef accumulator:
        //   toUsers = totalYield × Σ(principal_i × retainBps_i) / (totalPrincipal × BPS_DENOM)
        //   toPool  = totalYield − toUsers
        //
        //   totalRetainWeightedPrincipal = Σ(principal_i × retainBps_i) accumulated
        //   incrementally on each enterGame/withdraw/claimTicket — no iteration here.
        // totalRetainWeightedPrincipal = Σ(principal_i × retainBps_i / BPS_DENOM)
        // so toUsers = totalYield × totalRetainWeightedPrincipal / totalPrincipal
        // (BPS_DENOM already applied when accumulator was updated — do NOT divide again)
        uint256 toUsers = totalRetainWeightedPrincipal > 0
            ? (totalYield * totalRetainWeightedPrincipal) / totalPrincipal
            : 0;
        if (toUsers > totalYield) toUsers = totalYield; // safety cap against precision errors
        uint256 toPool = totalYield - toUsers;

        // Single vault redeem: harvest all yield shares in one call (O(1))
        uint256 sharesToRedeem = vault.previewWithdraw(totalYield);
        if (sharesToRedeem > enrolledShares) sharesToRedeem = enrolledShares;
        uint256 actualReceived = vault.redeem(sharesToRedeem, address(this), address(this));

        // Rescale split to match actual received (rounding may make actualReceived ≠ totalYield)
        if (totalYield > 0) {
            toPool  = toPool * actualReceived / totalYield;
        }
        toUsers = actualReceived > toPool ? actualReceived - toPool : 0;

        r.prizePool           += toPool;
        r.enrolledVaultShares -= sharesToRedeem;

        // Store harvest share factor for lazy per-user share adjustment:
        //   effectiveShares = u.vaultShares × factor / 1e18
        // Applied in withdraw() and _processRollover() without iterating users.
        uint256 remainingShares = enrolledShares - sharesToRedeem;
        roundHarvestShareFactor[currentRound] = remainingShares * 1e18 / enrolledShares;

        // Store yield rate for lazy per-user yield claims via claimYield():
        //   userRetained = userPrincipal × rate / 1e18 × userRetainBps / BPS_DENOM
        // toUsers (retained USDC) stays in contract balance, claimed by users individually.
        roundYieldPerPrincipal[currentRound] = actualReceived * 1e18 / totalPrincipal;
    }

    // ── _startNewRound — O(1) ─────────────────────────────────────────────────
    //
    //  OLD: looped all N previous participants, recalculated weights, and minted
    //       N NFTs → O(N × ~50k gas) inside VRF callback → Out-of-Gas DoS.
    //
    //  NEW: just initialises a RoundInfo struct. No loops. No NFT minting.
    //       Users enroll in the new round by calling claimTicket() or enterGame().
    //       Each such call is O(1) and paid by the user.
    //
    function _startNewRound() internal {
        // Reset per-round accumulator; rebuilt as users enroll via claimTicket/enterGame
        totalRetainWeightedPrincipal = 0;

        currentRound++;
        uint256 start = block.timestamp;
        rounds[currentRound] = RoundInfo({
            startTime:           start,
            endTime:             start + roundDuration,
            totalPrincipal:      0,
            enrolledVaultShares: 0,
            prizePool:           0,
            totalWeight:         0,
            state:               RoundState.OPEN,
            winner:              address(0)
        });

        emit RoundStarted(currentRound, start, start + roundDuration);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

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

    /// @notice Preview how much retained yield a user can claim from a settled round.
    function previewClaimYield(uint256 roundId, address user) external view returns (uint256) {
        if (rounds[roundId].state != RoundState.SETTLED) return 0;
        if (userYieldClaimed[roundId][user]) return 0;
        uint256 userPrincipal = _userRoundPrincipal[roundId][user];
        if (userPrincipal == 0) return 0;
        uint256 yieldRate = roundYieldPerPrincipal[roundId];
        if (yieldRate == 0) return 0;
        uint256 userRetainBps = _userRoundRetainBps[roundId][user];
        return userPrincipal * yieldRate / 1e18 * userRetainBps / BPS_DENOM;
    }

    /// @notice Returns true if the user has principal but has not yet enrolled
    ///         in the current round (needs to call claimTicket or enterGame).
    function needsRollover(address user) external view returns (bool) {
        UserInfo storage u = users[user];
        return u.principal > 0 && u.roundJoined != currentRound;
    }
}
