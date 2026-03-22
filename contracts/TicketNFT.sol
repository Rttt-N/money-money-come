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
        uint8   tier;           // 1 = Worker, 2 = Player, 3 = VIP
        uint256 depositAmount;  // USDC deposited (6 decimals)
        uint256 weightBasisPts; // Probability weight × 10_000 (e.g. 5000 = 0.5×)
        uint256 mintedAt;       // Block timestamp of mint
    }

    // ─── State ────────────────────────────────────────────────────────────────

    uint256 private _nextTokenId;

    /// @dev tokenId → ticket metadata
    mapping(uint256 => TicketInfo) public tickets;

    /// @dev user address + roundId → tokenId (0 = none)
    mapping(address => mapping(uint256 => uint256)) public userRoundTicket;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TicketMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint256 indexed roundId,
        uint8   tier,
        uint256 depositAmount
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
     * @param to            Recipient (the depositor)
     * @param roundId       Current round identifier
     * @param tier          1/2/3
     * @param depositAmount USDC amount in 6-decimal units
     * @param weightBps     Probability weight in basis points (10_000 = 1.0×)
     * @return tokenId      Newly minted token ID
     */
    function mint(
        address to,
        uint256 roundId,
        uint8   tier,
        uint256 depositAmount,
        uint256 weightBps
    ) external onlyOwner returns (uint256 tokenId) {
        require(userRoundTicket[to][roundId] == 0, "TicketNFT: already has ticket for this round");
        require(tier >= 1 && tier <= 3, "TicketNFT: invalid tier");

        tokenId = ++_nextTokenId;

        tickets[tokenId] = TicketInfo({
            roundId:       roundId,
            tier:          tier,
            depositAmount: depositAmount,
            weightBasisPts: weightBps,
            mintedAt:      block.timestamp
        });

        userRoundTicket[to][roundId] = tokenId;

        _safeMint(to, tokenId);

        emit TicketMinted(to, tokenId, roundId, tier, depositAmount);
    }

    /**
     * @notice Burn a ticket on withdrawal. Called by MoneyMoneyCome.
     * @param tokenId Token to burn
     */
    function burn(uint256 tokenId) external onlyOwner {
        address owner = ownerOf(tokenId);
        uint256 roundId = tickets[tokenId].roundId;

        delete userRoundTicket[owner][roundId];
        delete tickets[tokenId];

        _burn(tokenId);

        emit TicketBurned(tokenId, owner);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getTicket(uint256 tokenId) external view returns (TicketInfo memory) {
        require(_ownerOf(tokenId) != address(0), "TicketNFT: token does not exist");
        return tickets[tokenId];
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    // ─── Token URI (override with IPFS or on-chain SVG in production) ─────────

    function _baseURI() internal pure override returns (string memory) {
        return "https://api.moneymoneycomeprotocol.xyz/metadata/";
    }
}
