// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

enum MarketPhase {
    INFO_COLLECTION,
    TRADING,
    RESOLVED
}

enum Outcome {
    NONE,
    YES,
    NO
}

struct MarketConfig {
    uint256 marketId;
    string question;
    string schemaJson;
    uint256 maxSlots;
    uint256 ticketCost;
    uint256 marketCap;
    uint256 creatorOffer;
    uint64 drandTargetRound;
    bytes32 drandChainHash;
    uint48 createdAt;
    uint48 tradingDuration;
    address creator;
    uint256 optionCount;  // number of binary submarkets (0 or 1 = single submarket at index 0)
}

struct SubmarketConfig {
    uint256 parentMarketId;
    uint256 optionIndex;
    string  optionLabel;   // e.g., "Greater than 40,000 USD"
}

struct EncryptedSubmission {
    address agent;
    bytes ciphertext;
    bytes32 validationHash;
    uint64 targetRound;
}

struct MarketState {
    MarketPhase phase;
    bytes32 merkleRoot;
    Outcome consensusOutcome;
    uint128 reserveYes;
    uint128 reserveNo;
    uint128 totalClaimedYes;
    uint128 totalClaimedNo;
    Outcome resolvedOutcome;
    // Total shares minted in the Phase 1 merkle tree (sum of all agents' allocations).
    // Stored at reveal time so the indexer can compute each agent's ownership %.
    uint128 totalYesShares;
    uint128 totalNoShares;
    // IPFS URI pointing to the JSON with all merkle leaves (agent, yesShares, noShares, proof).
    string leavesURI;
}

struct AgentState {
    uint128 yesShares;
    uint128 noShares;
    bool participatedInInfo;
    bool claimedInitialShares;
}

struct MerkleProof {
    bytes32 root;
    bytes32[] proof;
    uint256 index;
    address agent;
    uint256 yesShares;
    uint256 noShares;
}

interface IMarket {
    // ── Parent-level events (uint256 marketId) ──────────────────────────────

    event MarketCreated(
        uint256 indexed marketId,
        string question,
        string schemaJson,
        uint256 maxSlots,
        uint256 ticketCost,
        uint64 drandTargetRound,
        uint256 creatorOffer,
        uint256 optionCount
    );

    event EncryptedSubmissionReceived(
        uint256 indexed marketId,
        address indexed agent,
        bytes32 validationHash,
        uint64 targetRound,
        bytes ciphertext
    );

    event InfoRevealRequested(
        uint256 indexed marketId,
        uint64 drandTargetRound,
        uint256 submissionCount
    );

    // ── Submarket creation ──────────────────────────────────────────────────

    event SubmarketCreated(
        uint256 indexed parentMarketId,
        bytes32 indexed submarketId,
        uint256 optionIndex,
        string  optionLabel
    );

    // ── Submarket-level events (bytes32 submarketId) ────────────────────────

    event InfoPhaseRevealed(
        bytes32 indexed submarketId,
        bytes32 merkleRoot,
        Outcome consensusOutcome,
        uint128 totalReserveYes,
        uint128 totalReserveNo,
        uint256 validSubmissions,
        uint128 totalYesShares,
        uint128 totalNoShares,
        string leavesURI
    );

    event Phase1Resolved(bytes32 indexed submarketId);

    event Phase2Resolved(bytes32 indexed submarketId);

    event SharesClaimed(
        bytes32 indexed submarketId,
        address indexed agent,
        uint256 yesShares,
        uint256 noShares
    );

    event SharesSwapped(
        bytes32 indexed submarketId,
        address indexed agent,
        Outcome burnedOutcome,
        Outcome mintedOutcome,
        uint256 burnAmount,
        uint256 mintAmount
    );

    event MarketResolved(
        bytes32 indexed submarketId,
        Outcome outcome
    );

    event PayoutClaimed(
        bytes32 indexed submarketId,
        address indexed agent,
        uint256 amount
    );

    event PenaltyCollected(
        bytes32 indexed submarketId,
        address indexed agent,
        address indexed creator,
        uint256 penaltyAmount
    );

    event CreatorFallbackClaimed(
        bytes32 indexed submarketId,
        address indexed creator,
        uint256 amount
    );

    event ResolutionRequested(
        bytes32 indexed submarketId,
        uint48 tradingEnd
    );

    // ── Parent-level functions ───────────────────────────────────────────────

    function createMarket(
        string calldata question,
        string calldata schemaJson,
        uint256 maxSlots,
        uint256 ticketCost,
        uint256 creatorOffer,
        uint64 drandTargetRound,
        bytes32 drandChainHash,
        uint48 tradingDuration,
        uint256 optionCount
    ) external returns (uint256 marketId);

    function createSubmarket(
        uint256 parentMarketId,
        uint256 optionIndex,
        string calldata optionLabel
    ) external returns (bytes32 submarketId);

    function getSubmarketId(uint256 parentId, uint256 optionIndex)
        external pure returns (bytes32);

    function submitEncrypted(
        uint256 marketId,
        bytes calldata ciphertext,
        bytes32 validationHash
    ) external;

    function requestInfoReveal(uint256 marketId) external;

    // ── Submarket-level functions ────────────────────────────────────────────

    function revealInfoPhase(
        bytes32 submarketId,
        bytes32 merkleRoot,
        Outcome consensusOutcome,
        uint128 totalReserveYes,
        uint128 totalReserveNo,
        uint256 validSubmissions,
        uint128 totalYesShares,
        uint128 totalNoShares,
        string calldata leavesURI
    ) external;

    function claimShares(
        bytes32 submarketId,
        MerkleProof calldata proof
    ) external;

    function resolveMarket(
        bytes32 submarketId,
        Outcome outcome
    ) external;

    function requestResolution(bytes32 submarketId) external;

    function claimPayout(bytes32 submarketId) external;

    function claimCreatorFallback(bytes32 submarketId) external;

    function setPenaltyFactors(
        bytes32 submarketId,
        address[] calldata agents,
        uint256[] calldata factors
    ) external;

    // ── View functions ────────────────────────────────────────────────────────

    function getSubmission(uint256 marketId, uint256 index)
        external view returns (EncryptedSubmission memory);

    function getSubmissionCount(uint256 marketId) external view returns (uint256);

    function getAllSubmissions(uint256 marketId) external view returns (EncryptedSubmission[] memory);

    function batchRevealInfoPhase(
        bytes32[] calldata submarketIds,
        bytes32[] calldata merkleRoots,
        Outcome[] calldata consensusOutcomes,
        uint128[] calldata totalReserveYes,
        uint128[] calldata totalReserveNo,
        uint256[] calldata validSubmissions,
        uint128[] calldata totalYesShares,
        uint128[] calldata totalNoShares,
        string calldata leavesURI
    ) external;

    function batchResolveMarket(
        bytes32[] calldata submarketIds,
        Outcome[] calldata outcomes
    ) external;

    function batchSetPenaltyFactors(
        bytes32[] calldata submarketIds,
        address[][] calldata agentsPerSubmarket,
        uint256[][] calldata factorsPerSubmarket
    ) external;

    function batchClaimPayout(bytes32[] calldata submarketIds) external;

    function batchClaimShares(
        bytes32[] calldata submarketIds,
        MerkleProof[] calldata proofs
    ) external;

    function getPriceRatio(bytes32 submarketId)
        external view returns (uint256 priceYes, uint256 priceNo);

    function canTrade(bytes32 submarketId, address agent) external view returns (bool);

    function isTradingActive(bytes32 submarketId) external view returns (bool);

    function creatorPremium(uint256 marketId) external view returns (uint256);

    function totalLiquidity(uint256 marketId) external view returns (uint256);

    function executeOrderbookTrade(
        bytes32 submarketId,
        address maker,
        address taker,
        bool makerSellsYes,
        uint256 sharesAmount,
        uint256 takerPaysAmount
    ) external;
}
