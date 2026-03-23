// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SquadRegistry
 * @notice Manages Luck Squad creation, membership, and prize distribution logic.
 *
 * Rules enforced:
 *  - Max 10 members per squad
 *  - A user can only be in one squad at a time
 *  - Rewards split: 80% to winner, 20% proportional to other members by weight
 *  - Sybil resistance: distribution is weight-based, not head-count-based
 */
contract SquadRegistry is Ownable {
    // ─── Structs ──────────────────────────────────────────────────────────────

    struct Squad {
        address   leader;
        address[] members;        // includes leader
        bool      active;
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_MEMBERS  = 10;
    uint256 public constant WINNER_BPS   = 8000; // 80%
    uint256 public constant SQUAD_BPS    = 2000; // 20% split among other members
    uint256 public constant BPS_DENOM    = 10_000;

    // ─── State ────────────────────────────────────────────────────────────────

    uint256 private _nextSquadId;

    mapping(uint256 => Squad)    private _squads;
    mapping(address => uint256)  public  userSquad; // 0 = no squad

    // ─── Events ───────────────────────────────────────────────────────────────

    event SquadCreated(uint256 indexed squadId, address indexed leader);
    event MemberJoined(uint256 indexed squadId, address indexed member);
    event MemberLeft(uint256 indexed squadId, address indexed member);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ─── Squad Management ─────────────────────────────────────────────────────

    /**
     * @notice Create a new squad. Caller becomes leader.
     * @return squadId Newly created squad ID
     */
    function createSquad() external returns (uint256 squadId) {
        require(userSquad[msg.sender] == 0, "SquadRegistry: already in a squad");

        squadId = ++_nextSquadId;
        Squad storage s = _squads[squadId];
        s.leader  = msg.sender;
        s.active  = true;
        s.members.push(msg.sender);

        userSquad[msg.sender] = squadId;

        emit SquadCreated(squadId, msg.sender);
    }

    /**
     * @notice Join an existing squad. Called by a user directly.
     * @param squadId Target squad
     */
    function joinSquad(uint256 squadId) external {
        require(userSquad[msg.sender] == 0, "SquadRegistry: already in a squad");
        Squad storage s = _squads[squadId];
        require(s.active, "SquadRegistry: squad not active");
        require(s.members.length < MAX_MEMBERS, "SquadRegistry: squad full");

        s.members.push(msg.sender);
        userSquad[msg.sender] = squadId;

        emit MemberJoined(squadId, msg.sender);
    }

    /**
     * @notice Leave current squad.
     */
    function leaveSquad() external {
        uint256 squadId = userSquad[msg.sender];
        require(squadId != 0, "SquadRegistry: not in a squad");

        _removeMember(squadId, msg.sender);
        userSquad[msg.sender] = 0;

        emit MemberLeft(squadId, msg.sender);
    }

    // ─── Prize Distribution (called by main contract) ─────────────────────────

    /**
     * @notice Calculate squad prize shares when a squad member wins.
     * @param winner              The winning address
     * @param totalPrize          Total jackpot (6-decimal USDC)
     * @param memberWeights_addr  Addresses of squad members (must include winner)
     * @param memberWeights_val   Probability weight of each member (parallel array)
     * @return winnerAmount       USDC to pay the winner (80%)
     * @return otherMembers       Addresses of non-winning squad members
     * @return otherAmounts       USDC amounts for each non-winning member (sums to 20%)
     */
    function calcSquadPrize(
        address   winner,
        uint256   totalPrize,
        address[] calldata memberWeights_addr,
        uint256[] calldata memberWeights_val
    )
        external
        pure
        returns (
            uint256   winnerAmount,
            address[] memory otherMembers,
            uint256[] memory otherAmounts
        )
    {
        require(memberWeights_addr.length == memberWeights_val.length, "SquadRegistry: length mismatch");

        winnerAmount = (totalPrize * WINNER_BPS) / BPS_DENOM;
        uint256 squadPool = totalPrize - winnerAmount; // 20%

        // Sum weights of non-winning members
        uint256 totalOtherWeight;
        uint256 otherCount;
        for (uint256 i; i < memberWeights_addr.length; i++) {
            if (memberWeights_addr[i] != winner) {
                totalOtherWeight += memberWeights_val[i];
                otherCount++;
            }
        }

        otherMembers = new address[](otherCount);
        otherAmounts = new uint256[](otherCount);

        if (totalOtherWeight == 0 || otherCount == 0) {
            // No other members — winner takes all
            winnerAmount = totalPrize;
            return (winnerAmount, otherMembers, otherAmounts);
        }

        // L-1: assign remainder to the last member to avoid dust being locked
        uint256 idx;
        uint256 distributed;
        for (uint256 i; i < memberWeights_addr.length; i++) {
            if (memberWeights_addr[i] != winner) {
                otherMembers[idx] = memberWeights_addr[i];
                if (idx < otherCount - 1) {
                    otherAmounts[idx] = (squadPool * memberWeights_val[i]) / totalOtherWeight;
                    distributed += otherAmounts[idx];
                } else {
                    otherAmounts[idx] = squadPool - distributed; // remainder to last
                }
                idx++;
            }
        }
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getSquad(uint256 squadId) external view returns (
        address leader,
        address[] memory members,
        bool active
    ) {
        Squad storage s = _squads[squadId];
        return (s.leader, s.members, s.active);
    }

    function getSquadMembers(uint256 squadId) external view returns (address[] memory) {
        return _squads[squadId].members;
    }

    function getMemberCount(uint256 squadId) external view returns (uint256) {
        return _squads[squadId].members.length;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _removeMember(uint256 squadId, address member) internal {
        Squad storage s = _squads[squadId];
        uint256 len = s.members.length;
        for (uint256 i; i < len; i++) {
            if (s.members[i] == member) {
                s.members[i] = s.members[len - 1];
                s.members.pop();
                break;
            }
        }
        // L-3: reassign leader if the leader just left
        if (s.leader == member && s.members.length > 0) {
            s.leader = s.members[0];
        }
        // If squad is now empty, deactivate
        if (s.members.length == 0) {
            s.active = false;
        }
    }
}
