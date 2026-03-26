// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TicketNFT
 * @notice ERC-721 NFT minted to represent participation in each round.
 *         Only the MoneyMoneyCome main contract can mint and burn tickets.
 */
contract TicketNFT is ERC721, Ownable {
    // ─── Structs ──────────────────────────────────────────────────────────────

    struct TicketInfo {
        uint256 roundId;        // Which round this ticket belongs to
        address originalOwner;  // M-1: original minter; used by burn() to clear mapping correctly
        uint256 tier1Amount;    // USDC deposited at Tier 1 (Worker)
        uint256 tier2Amount;    // USDC deposited at Tier 2 (Player)
        uint256 tier3Amount;    // USDC deposited at Tier 3 (VIP)
        uint256 weightBasisPts; // Probability weight × 10_000 (e.g. 5000 = 0.5×)
        uint256 mintedAt;       // Block timestamp of mint
    }

    // ─── State ────────────────────────────────────────────────────────────────

    uint256 private _nextTokenId;
    uint256 private _burnedCount; // L-2: track burns for accurate totalSupply

    /// @dev tokenId → ticket metadata
    mapping(uint256 => TicketInfo) public tickets;

    /// @dev user address + roundId → tokenId (0 = none)
    mapping(address => mapping(uint256 => uint256)) public userRoundTicket;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TicketMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint256 indexed roundId,
        uint256 tier1Amount,
        uint256 tier2Amount,
        uint256 tier3Amount
    );

    event TicketBurned(uint256 indexed tokenId, address indexed owner);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address initialOwner)
        ERC721("MoneyMoneyCome Ticket", "MMCT")
        Ownable(initialOwner)
    {}

    // ─── Minting / Burning (onlyOwner = main contract) ────────────────────────

    /**
     * @notice Mint a participation ticket. Called by MoneyMoneyCome on deposit.
     * @param to          Recipient (the depositor)
     * @param roundId     Current round identifier
     * @param tier1Amount USDC deposited at Tier 1 (6 decimals)
     * @param tier2Amount USDC deposited at Tier 2 (6 decimals)
     * @param tier3Amount USDC deposited at Tier 3 (6 decimals)
     * @param weightBps   Probability weight in basis points (10_000 = 1.0×)
     * @return tokenId    Newly minted token ID
     */
    function mint(
        address to,
        uint256 roundId,
        uint256 tier1Amount,
        uint256 tier2Amount,
        uint256 tier3Amount,
        uint256 weightBps
    ) external onlyOwner returns (uint256 tokenId) {
        require(userRoundTicket[to][roundId] == 0, "TicketNFT: already has ticket for this round");

        tokenId = ++_nextTokenId;

        tickets[tokenId] = TicketInfo({
            roundId:        roundId,
            originalOwner:  to,          // M-1: record minter permanently
            tier1Amount:    tier1Amount,
            tier2Amount:    tier2Amount,
            tier3Amount:    tier3Amount,
            weightBasisPts: weightBps,
            mintedAt:       block.timestamp
        });

        userRoundTicket[to][roundId] = tokenId;

        _mint(to, tokenId); // NEW-CL-1: avoid reentrancy via onERC721Received callback

        emit TicketMinted(to, tokenId, roundId, tier1Amount, tier2Amount, tier3Amount);
    }

    /**
     * @notice Burn a ticket on withdrawal. Called by MoneyMoneyCome.
     * @param tokenId Token to burn
     */
    function burn(uint256 tokenId) external onlyOwner {
        address owner         = ownerOf(tokenId);
        address originalOwner = tickets[tokenId].originalOwner; // M-1: use original minter
        uint256 roundId       = tickets[tokenId].roundId;

        delete userRoundTicket[originalOwner][roundId]; // M-1: always clear the minter's mapping
        delete tickets[tokenId];

        _burnedCount++; // L-2: track burned count
        _burn(tokenId);

        emit TicketBurned(tokenId, owner);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getTicket(uint256 tokenId) external view returns (TicketInfo memory) {
        require(_ownerOf(tokenId) != address(0), "TicketNFT: token does not exist");
        return tickets[tokenId];
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - _burnedCount; // L-2: circulating supply only
    }

    // ─── Soulbound: block transfers (NEW-CL-6) ────────────────────────────────

    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = _ownerOf(tokenId);
        // Allow only mint (from == 0) and burn (to == 0)
        require(from == address(0) || to == address(0), "TicketNFT: non-transferable");
        return super._update(to, tokenId, auth);
    }

    // ─── Token URI (override with IPFS or on-chain SVG in production) ─────────

    function _baseURI() internal pure override returns (string memory) {
        return "https://api.moneymoneycomeprotocol.xyz/metadata/";
    }
}
