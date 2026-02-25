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
    uint64 drandTargetRound;
    bytes32 drandChainHash;
    uint48 createdAt;
    uint48 tradingDuration;
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
    event MarketCreated(
        uint256 indexed marketId,
        string question,
        uint256 maxSlots,
        uint256 ticketCost,
        uint64 drandTargetRound
    );

    event EncryptedSubmissionReceived(
        uint256 indexed marketId,
        address indexed agent,
        bytes32 validationHash,
        uint64 targetRound
    );

    event InfoPhaseRevealed(
        uint256 indexed marketId,
        bytes32 merkleRoot,
        Outcome consensusOutcome,
        uint128 totalReserveYes,
        uint128 totalReserveNo,
        uint256 validSubmissions,
        uint128 totalYesShares,
        uint128 totalNoShares,
        string leavesURI
    );

    event SharesClaimed(
        uint256 indexed marketId,
        address indexed agent,
        uint256 yesShares,
        uint256 noShares
    );

    event SharesSwapped(
        uint256 indexed marketId,
        address indexed agent,
        Outcome burnedOutcome,
        Outcome mintedOutcome,
        uint256 burnAmount,
        uint256 mintAmount
    );

    event MarketResolved(
        uint256 indexed marketId,
        Outcome outcome
    );

    event PayoutClaimed(
        uint256 indexed marketId,
        address indexed agent,
        uint256 amount
    );

    event InfoRevealRequested(
        uint256 indexed marketId,
        uint64 drandTargetRound,
        uint256 submissionCount
    );

    event ResolutionRequested(
        uint256 indexed marketId,
        uint48 tradingEnd
    );

    function createMarket(
        string calldata question,
        string calldata schemaJson,
        uint256 maxSlots,
        uint256 ticketCost,
        uint64 drandTargetRound,
        bytes32 drandChainHash,
        uint48 tradingDuration
    ) external returns (uint256 marketId);

    function submitEncrypted(
        uint256 marketId,
        bytes calldata ciphertext,
        bytes32 validationHash
    ) external;

    function requestInfoReveal(uint256 marketId) external;

    function revealInfoPhase(
        uint256 marketId,
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
        uint256 marketId,
        MerkleProof calldata proof
    ) external;

    function swapShares(
        uint256 marketId,
        Outcome burnOutcome,
        uint256 burnAmount
    ) external returns (uint256 mintAmount);

    function resolveMarket(
        uint256 marketId,
        Outcome outcome
    ) external;

    function requestResolution(uint256 marketId) external;

    function claimPayout(uint256 marketId) external;

    function getSubmission(uint256 marketId, uint256 index) 
        external view returns (EncryptedSubmission memory);

    function getSubmissionCount(uint256 marketId) external view returns (uint256);

    function getPriceRatio(uint256 marketId)
        external view returns (uint256 priceYes, uint256 priceNo);

    function calculateSwapOutput(
        uint256 marketId,
        Outcome burnOutcome,
        uint256 burnAmount
    ) external view returns (uint256 mintAmount);

    function canTrade(uint256 marketId, address agent) external view returns (bool);

    function executeOrderbookTrade(
        uint256 marketId,
        address maker,
        address taker,
        bool makerSellsYes,
        uint256 sharesAmount,
        uint256 takerPaysAmount
    ) external;
}
