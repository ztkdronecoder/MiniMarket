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
    string schemaURI;
    address paymentToken;
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
    Outcome predictedOutcome;
    uint256 allocatedShares;
}

interface IMarket {
    event MarketCreated(
        uint256 indexed marketId,
        string question,
        string schemaURI,
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
        uint256 validSubmissions
    );

    event SharesClaimed(
        uint256 indexed marketId,
        address indexed agent,
        Outcome outcome,
        uint256 shares
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
        string schemaURI,
        uint48 tradingEnd
    );

    function createMarket(
        string calldata question,
        string calldata schemaURI,
        address paymentToken,
        uint256 maxSlots,
        uint256 ticketCost,
        uint64 drandTargetRound,
        bytes32 drandChainHash,
        uint48 tradingDuration
    ) external payable returns (uint256 marketId);

    function submitEncrypted(
        uint256 marketId,
        bytes calldata ciphertext,
        bytes32 validationHash
    ) external payable;

    function requestInfoReveal(uint256 marketId) external;

    function revealInfoPhase(
        uint256 marketId,
        bytes32 merkleRoot,
        Outcome consensusOutcome,
        uint128 totalReserveYes,
        uint128 totalReserveNo,
        uint256 validSubmissions
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
}
