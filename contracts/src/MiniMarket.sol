// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IMarket, MarketPhase, Outcome, MarketConfig, SubmarketConfig, MarketState, AgentState, EncryptedSubmission, MerkleProof} from "./interfaces/IMarket.sol";
import {ICREReceiver} from "./interfaces/ICREReceiver.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ConstantSum} from "./libraries/ConstantSum.sol";
import {Quadratic} from "./libraries/Quadratic.sol";
import {MerkleProof as OZMerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MiniMarket
 * @notice Privacy-preserving prediction market using drand timelock encryption.
 * @dev Supports multi-option parent markets with N binary submarkets.
 *      Parent markets are keyed by uint256 marketId; submarkets by bytes32 submarketId.
 *      SubmarketId = keccak256(abi.encode(parentMarketId, optionIndex)).
 */
contract MiniMarket is IMarket, ICREReceiver, ReentrancyGuard, Ownable {
    uint256 public constant PRECISION = 1e18;
    bytes32 public constant DRAND_QUICKNET_HASH = 0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971;
    uint64 public constant DRAND_GENESIS = 1692803367;
    uint64 public constant DRAND_PERIOD = 3;

    address public immutable CRE_FORWARDER;
    address public immutable USDC;

    // ── Parent-keyed mappings (uint256 marketId) ─────────────────────────────
    mapping(uint256 => MarketConfig) public configs;
    mapping(uint256 => EncryptedSubmission[]) public submissions;
    mapping(uint256 => mapping(address => AgentState)) public agentStates;   // participatedInInfo only
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;
    mapping(uint256 => bool) public infoRevealRequested;

    // ── Submarket-keyed mappings (bytes32 submarketId) ────────────────────────
    mapping(bytes32 => SubmarketConfig) public submarketConfigs;
    mapping(bytes32 => MarketState)     public submarketStates;
    mapping(bytes32 => mapping(address => AgentState)) public submarketAgentStates;
    mapping(bytes32 => mapping(address => uint256)) public penaltyFactors;
    mapping(bytes32 => bool) public resolutionRequested;
    mapping(bytes32 => bool) public creatorFallbackClaimed;

    mapping(address => bool) private _authorizedSigners;
    mapping(address => uint256) public reputation;

    address public orderbook;

    uint256 private _nextMarketId = 1;

    modifier onlyCREForwarder() {
        require(msg.sender == CRE_FORWARDER, UnauthorizedForwarder());
        _;
    }

    modifier onlyAuthorizedSigner() {
        require(_authorizedSigners[msg.sender], UnauthorizedSigner());
        _;
    }

    modifier validMarket(uint256 marketId) {
        require(marketId < _nextMarketId, InvalidMarket());
        _;
    }

    modifier validSubmarket(bytes32 submarketId) {
        require(submarketConfigs[submarketId].parentMarketId > 0, InvalidSubmarket());
        _;
    }

    modifier inSubmarketPhase(bytes32 submarketId, MarketPhase requiredPhase) {
        MarketPhase currentPhase = _getSubmarketPhase(submarketId);
        require(currentPhase == requiredPhase, InvalidPhase());
        _;
    }

    error UnauthorizedForwarder();
    error UnauthorizedSigner();
    error InvalidMarket();
    error InvalidSubmarket();
    error InvalidPhase();
    error MarketFull();
    error AlreadySubmitted();
    error NotInfoParticipant();
    error AlreadyClaimedShares();
    error InvalidMerkleProof();
    error InsufficientShares();
    error AlreadyResolved();
    error NothingToClaim();
    error CreatorFallbackNotApplicable();
    error CreatorFallbackAlreadyClaimed();
    error NotCreator();
    error TransferFailed();
    error InvalidTargetRound();
    error RoundAlreadyPassed();
    error InvalidReportSelector(uint8 selector);
    error UnauthorizedOrderbook();
    error PenaltyFactorTooHigh();
    error InvalidOptionIndex();

    modifier onlyOrderbook() {
        require(msg.sender == orderbook, UnauthorizedOrderbook());
        _;
    }

    constructor(address creForwarder, address initialOwner, address usdc) Ownable(initialOwner) {
        CRE_FORWARDER = creForwarder;
        USDC = usdc;
    }

    // ── Market creation ───────────────────────────────────────────────────────

    /**
     * @notice Create a new prediction market with optional multiple binary submarkets.
     * @param question The market question
     * @param schemaJson Resolution schema JSON (stored on-chain)
     * @param maxSlots Maximum number of participants
     * @param ticketCost Cost per ticket in USDC (6 decimals)
     * @param creatorOffer Premium per submarket; added to payout pool, split among winners by share
     * @param drandTargetRound Drand round for timelock reveal
     * @param drandChainHash Drand network identifier
     * @param tradingDuration Duration of trading phase in seconds
     * @param optionCount Number of binary submarkets (0 or 1 = single implicit submarket)
     * @return marketId The ID of the created market
     */
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
    ) external nonReentrant returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(bytes(schemaJson).length > 0, "Empty schema");
        require(maxSlots > 0, "Zero slots");
        require(ticketCost > 0, "Zero cost");
        require(tradingDuration > 0, "Zero duration");

        marketId = _nextMarketId++;

        MarketConfig storage config = configs[marketId];
        config.marketId = marketId;
        config.question = question;
        config.schemaJson = schemaJson;
        config.maxSlots = maxSlots;
        config.ticketCost = ticketCost;
        config.marketCap = maxSlots * ticketCost;
        config.creatorOffer = creatorOffer;
        config.drandTargetRound = drandTargetRound;
        config.drandChainHash = drandChainHash;
        config.createdAt = uint48(block.timestamp);
        config.tradingDuration = tradingDuration;
        config.creator = msg.sender;
        config.optionCount = optionCount;

        // Creator provides collateral (marketCap) once + CRE premium per submarket.
        uint256 effectiveOptionCount = optionCount > 1 ? optionCount : 1;
        uint256 totalDeposit = config.marketCap + creatorOffer * effectiveOptionCount;
        IERC20(USDC).transferFrom(msg.sender, address(this), totalDeposit);

        emit MarketCreated(marketId, question, schemaJson, maxSlots, ticketCost, drandTargetRound, creatorOffer, optionCount);

        // Auto-create all N submarkets in contract storage (no event — indexer creates stubs from MarketCreated).
        uint256 effectiveCount = optionCount > 1 ? optionCount : 1;
        for (uint256 i = 0; i < effectiveCount; i++) {
            bytes32 smId = getSubmarketId(marketId, i);
            submarketConfigs[smId] = SubmarketConfig({
                parentMarketId: marketId,
                optionIndex: i,
                optionLabel: ""
            });
            submarketStates[smId].phase = MarketPhase.INFO_COLLECTION;
        }
    }

    /**
     * @notice Register a submarket for a parent market.
     * @dev Callable by the market creator or owner.
     *      Submarket ID is deterministic: keccak256(abi.encode(parentMarketId, optionIndex)).
     * @param parentMarketId Parent market ID
     * @param optionIndex Zero-based option index (must be < optionCount, or 0 for single-option)
     * @param optionLabel Human-readable option label (e.g. "Greater than 40,000 USD")
     * @return submarketId Deterministic bytes32 submarket identifier
     */
    function createSubmarket(
        uint256 parentMarketId,
        uint256 optionIndex,
        string calldata optionLabel
    ) external validMarket(parentMarketId) returns (bytes32 submarketId) {
        MarketConfig storage config = configs[parentMarketId];
        require(
            msg.sender == config.creator || msg.sender == owner(),
            "Unauthorized"
        );
        uint256 effectiveCount = config.optionCount > 1 ? config.optionCount : 1;
        require(optionIndex < effectiveCount, InvalidOptionIndex());

        submarketId = getSubmarketId(parentMarketId, optionIndex);

        if (submarketConfigs[submarketId].parentMarketId != 0) {
            // Already auto-created by createMarket — just update the label.
            submarketConfigs[submarketId].optionLabel = optionLabel;
            emit SubmarketCreated(parentMarketId, submarketId, optionIndex, optionLabel);
            return submarketId;
        }

        submarketConfigs[submarketId] = SubmarketConfig({
            parentMarketId: parentMarketId,
            optionIndex: optionIndex,
            optionLabel: optionLabel
        });
        submarketStates[submarketId].phase = MarketPhase.INFO_COLLECTION;

        emit SubmarketCreated(parentMarketId, submarketId, optionIndex, optionLabel);
    }

    /**
     * @notice Compute deterministic submarket ID.
     */
    function getSubmarketId(uint256 parentId, uint256 optionIndex)
        public pure returns (bytes32)
    {
        return keccak256(abi.encode(parentId, optionIndex));
    }

    // ── Phase 1: Info collection ──────────────────────────────────────────────

    /**
     * @notice Submit encrypted prediction for Phase 1.
     * @dev Parent market must not have been revealed yet.
     * @param marketId Parent market ID
     * @param ciphertext Timelock-encrypted payload
     * @param validationHash keccak256(outcome, agent, salt)
     */
    function submitEncrypted(
        uint256 marketId,
        bytes calldata ciphertext,
        bytes32 validationHash
    ) external nonReentrant validMarket(marketId) {
        MarketConfig storage config = configs[marketId];

        require(!infoRevealRequested[marketId], "Reveal already requested");
        // Once the drand round is reachable the market has effectively transitioned
        uint64 currentRound = _currentDrandRound();
        require(currentRound < config.drandTargetRound, RoundAlreadyPassed());

        require(submissions[marketId].length < config.maxSlots, MarketFull());
        require(!hasSubmitted[marketId][msg.sender], AlreadySubmitted());
        require(ciphertext.length > 0, "Empty ciphertext");

        uint256 effectiveOptionCount = config.optionCount > 1 ? config.optionCount : 1;
        uint256 totalCost = config.ticketCost * effectiveOptionCount;
        IERC20(USDC).transferFrom(msg.sender, address(this), totalCost);

        submissions[marketId].push(EncryptedSubmission({
            agent: msg.sender,
            ciphertext: ciphertext,
            validationHash: validationHash,
            targetRound: config.drandTargetRound
        }));

        hasSubmitted[marketId][msg.sender] = true;
        agentStates[marketId][msg.sender].participatedInInfo = true;

        emit EncryptedSubmissionReceived(
            marketId,
            msg.sender,
            validationHash,
            config.drandTargetRound,
            ciphertext
        );
    }

    /**
     * @notice Request info phase reveal after drand round is reached.
     */
    function requestInfoReveal(uint256 marketId) external validMarket(marketId) {
        MarketConfig storage config = configs[marketId];

        require(!infoRevealRequested[marketId], "Already requested");

        uint64 currentRound = _currentDrandRound();
        require(currentRound >= config.drandTargetRound, "Round not reached");

        infoRevealRequested[marketId] = true;

        emit InfoRevealRequested(
            marketId,
            config.drandTargetRound,
            submissions[marketId].length
        );
    }

    /**
     * @notice Reveal info phase for a specific submarket.
     * @dev Only callable by CRE forwarder.
     */
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
    ) external nonReentrant validSubmarket(submarketId) onlyCREForwarder {
        _revealInfoPhase(
            submarketId,
            merkleRoot,
            consensusOutcome,
            totalReserveYes,
            totalReserveNo,
            validSubmissions,
            totalYesShares,
            totalNoShares,
            leavesURI
        );
    }

    function _revealInfoPhase(
        bytes32 submarketId,
        bytes32 merkleRoot,
        Outcome consensusOutcome,
        uint128 totalReserveYes,
        uint128 totalReserveNo,
        uint256 validSubmissions,
        uint128 totalYesShares,
        uint128 totalNoShares,
        string memory leavesURI
    ) internal {
        MarketState storage state = submarketStates[submarketId];

        require(state.phase == MarketPhase.INFO_COLLECTION, InvalidPhase());
        require(state.merkleRoot == bytes32(0), "Already revealed");

        uint256 parentId = submarketConfigs[submarketId].parentMarketId;
        MarketConfig storage config = configs[parentId];
        uint64 currentRound = _currentDrandRound();
        require(currentRound >= config.drandTargetRound, "Round not reached");

        state.merkleRoot = merkleRoot;
        state.consensusOutcome = consensusOutcome;
        state.reserveYes = totalReserveYes;
        state.reserveNo = totalReserveNo;
        state.totalYesShares = totalYesShares;
        state.totalNoShares = totalNoShares;
        state.leavesURI = leavesURI;
        state.phase = MarketPhase.TRADING;

        emit InfoPhaseRevealed(
            submarketId,
            merkleRoot,
            consensusOutcome,
            totalReserveYes,
            totalReserveNo,
            validSubmissions,
            totalYesShares,
            totalNoShares,
            leavesURI
        );
        emit Phase1Resolved(submarketId);
    }

    // ── Phase 2: Trading ──────────────────────────────────────────────────────

    /**
     * @notice Claim initial shares via merkle proof (per submarket).
     */
    function claimShares(
        bytes32 submarketId,
        MerkleProof calldata proof
    ) external nonReentrant validSubmarket(submarketId)
      inSubmarketPhase(submarketId, MarketPhase.TRADING)
    {
        uint256 parentId = submarketConfigs[submarketId].parentMarketId;
        AgentState storage parentAgent = agentStates[parentId][msg.sender];
        require(parentAgent.participatedInInfo, NotInfoParticipant());

        AgentState storage subAgent = submarketAgentStates[submarketId][msg.sender];
        require(!subAgent.claimedInitialShares, AlreadyClaimedShares());
        require(proof.yesShares > 0 || proof.noShares > 0, "Zero shares");

        bytes32 leaf = keccak256(abi.encodePacked(proof.agent, proof.yesShares, proof.noShares));
        require(
            OZMerkleProof.verifyCalldata(proof.proof, proof.root, leaf),
            InvalidMerkleProof()
        );
        require(proof.root == submarketStates[submarketId].merkleRoot, "Root mismatch");
        require(proof.agent == msg.sender, "Agent mismatch");

        subAgent.claimedInitialShares = true;
        subAgent.yesShares += uint128(proof.yesShares);
        subAgent.noShares += uint128(proof.noShares);
        submarketStates[submarketId].totalClaimedYes += uint128(proof.yesShares);
        submarketStates[submarketId].totalClaimedNo += uint128(proof.noShares);

        uint256 totalAllocated = proof.yesShares + proof.noShares;
        reputation[msg.sender] += Quadratic.calculateReputationDelta(totalAllocated);

        emit SharesClaimed(submarketId, msg.sender, proof.yesShares, proof.noShares);
    }

    /**
     * @notice AMM-style swap: burn shares of one outcome, receive shares of the other.
     */
    function swapShares(
        bytes32 submarketId,
        Outcome burnOutcome,
        uint256 burnAmount
    ) external nonReentrant validSubmarket(submarketId)
      inSubmarketPhase(submarketId, MarketPhase.TRADING)
      returns (uint256 mintAmount)
    {
        require(burnAmount > 0, "Zero amount");

        uint256 parentId = submarketConfigs[submarketId].parentMarketId;
        AgentState storage parentAgent = agentStates[parentId][msg.sender];
        require(parentAgent.participatedInInfo, NotInfoParticipant());

        AgentState storage subAgent = submarketAgentStates[submarketId][msg.sender];
        require(subAgent.claimedInitialShares, "Must claim shares first");

        MarketState storage state = submarketStates[submarketId];

        if (burnOutcome == Outcome.YES) {
            require(subAgent.yesShares >= burnAmount, InsufficientShares());
            mintAmount = ConstantSum.calculateSwapOutput(state.reserveYes, state.reserveNo, burnAmount);
            require(mintAmount > 0, "Zero mint");
            subAgent.yesShares -= uint128(burnAmount);
            subAgent.noShares += uint128(mintAmount);
            state.reserveYes += uint128(burnAmount);
            state.reserveNo -= uint128(mintAmount);
            state.totalClaimedYes -= uint128(burnAmount);
            state.totalClaimedNo += uint128(mintAmount);
        } else {
            require(subAgent.noShares >= burnAmount, InsufficientShares());
            mintAmount = ConstantSum.calculateSwapOutput(state.reserveNo, state.reserveYes, burnAmount);
            require(mintAmount > 0, "Zero mint");
            subAgent.noShares -= uint128(burnAmount);
            subAgent.yesShares += uint128(mintAmount);
            state.reserveNo += uint128(burnAmount);
            state.reserveYes -= uint128(mintAmount);
            state.totalClaimedNo -= uint128(burnAmount);
            state.totalClaimedYes += uint128(mintAmount);
        }

        emit SharesSwapped(
            submarketId,
            msg.sender,
            burnOutcome,
            burnOutcome == Outcome.YES ? Outcome.NO : Outcome.YES,
            burnAmount,
            mintAmount
        );
    }

    /**
     * @notice Request resolution after trading period ends.
     */
    function requestResolution(bytes32 submarketId) external validSubmarket(submarketId) {
        MarketState storage state = submarketStates[submarketId];

        require(state.phase == MarketPhase.TRADING, InvalidPhase());
        require(state.resolvedOutcome == Outcome.NONE, AlreadyResolved());
        require(!resolutionRequested[submarketId], "Already requested");

        uint256 parentId = submarketConfigs[submarketId].parentMarketId;
        MarketConfig storage config = configs[parentId];
        uint48 tradingEnd = config.createdAt + config.tradingDuration;
        require(block.timestamp >= tradingEnd, "Trading not ended");

        resolutionRequested[submarketId] = true;

        emit ResolutionRequested(submarketId, tradingEnd);
    }

    /**
     * @notice Set per-agent penalty factors before resolution.
     * @dev Only callable by CRE forwarder. Factor in bps: 0=no penalty, 10000=100% penalty.
     */
    function setPenaltyFactors(
        bytes32 submarketId,
        address[] calldata agents,
        uint256[] calldata factors
    ) external validSubmarket(submarketId) onlyCREForwarder {
        require(agents.length == factors.length, "Length mismatch");
        for (uint256 i = 0; i < agents.length; i++) {
            require(factors[i] <= 10000, PenaltyFactorTooHigh());
            penaltyFactors[submarketId][agents[i]] = factors[i];
        }
    }

    /**
     * @notice Resolve a submarket with winning outcome.
     * @dev Only callable by CRE forwarder.
     */
    function resolveMarket(
        bytes32 submarketId,
        Outcome outcome
    ) external nonReentrant validSubmarket(submarketId) onlyCREForwarder {
        _resolveMarket(submarketId, outcome);
    }

    function _resolveMarket(bytes32 submarketId, Outcome outcome) internal {
        MarketState storage state = submarketStates[submarketId];

        require(state.phase == MarketPhase.TRADING, InvalidPhase());
        require(state.resolvedOutcome == Outcome.NONE, AlreadyResolved());

        state.resolvedOutcome = outcome;
        state.phase = MarketPhase.RESOLVED;

        emit MarketResolved(submarketId, outcome);
        emit Phase2Resolved(submarketId);
    }

    /**
     * @notice Claim payout for winning shares, applying any penalty set by CRE.
     */
    function claimPayout(bytes32 submarketId) external nonReentrant validSubmarket(submarketId)
        inSubmarketPhase(submarketId, MarketPhase.RESOLVED)
    {
        MarketState storage state = submarketStates[submarketId];
        AgentState storage subAgent = submarketAgentStates[submarketId][msg.sender];

        Outcome winningOutcome = state.resolvedOutcome;
        require(winningOutcome != Outcome.NONE, "Not resolved");

        uint256 winningShares = winningOutcome == Outcome.YES ? subAgent.yesShares : subAgent.noShares;
        require(winningShares > 0, NothingToClaim());

        uint256 totalWinning = winningOutcome == Outcome.YES
            ? state.totalClaimedYes
            : state.totalClaimedNo;

        uint256 parentId = submarketConfigs[submarketId].parentMarketId;
        MarketConfig storage parentConfig = configs[parentId];
        // Pool = ticketCost * nParticipants + creatorOffer (premium split among winners by share)
        uint256 pool = parentConfig.ticketCost * submissions[parentId].length + parentConfig.creatorOffer;
        uint256 fullPayout = (winningShares * pool) / totalWinning;

        uint256 penalty = (fullPayout * penaltyFactors[submarketId][msg.sender]) / 10000;

        if (winningOutcome == Outcome.YES) { subAgent.yesShares = 0; } else { subAgent.noShares = 0; }

        if (fullPayout - penalty > 0) {
            require(IERC20(USDC).transfer(msg.sender, fullPayout - penalty), TransferFailed());
        }
        address creator = configs[parentId].creator;
        if (penalty > 0) {
            require(IERC20(USDC).transfer(creator, penalty), TransferFailed());
        }

        emit PayoutClaimed(submarketId, msg.sender, fullPayout - penalty);
        if (penalty > 0) {
            emit PenaltyCollected(submarketId, msg.sender, creator, penalty);
        }
    }

    /**
     * @notice When everyone bet 100% on the wrong outcome, no one has winning shares.
     *         The pool stays locked. This lets the creator reclaim it.
     * @dev Only callable by market creator when totalWinning == 0 for the resolved outcome.
     */
    function claimCreatorFallback(bytes32 submarketId) external nonReentrant validSubmarket(submarketId)
        inSubmarketPhase(submarketId, MarketPhase.RESOLVED)
    {
        require(!creatorFallbackClaimed[submarketId], CreatorFallbackAlreadyClaimed());
        MarketState storage state = submarketStates[submarketId];
        Outcome winningOutcome = state.resolvedOutcome;
        require(winningOutcome != Outcome.NONE, "Not resolved");

        uint256 totalWinning = winningOutcome == Outcome.YES
            ? state.totalClaimedYes
            : state.totalClaimedNo;
        require(totalWinning == 0, CreatorFallbackNotApplicable());

        uint256 parentId = submarketConfigs[submarketId].parentMarketId;
        address creator = configs[parentId].creator;
        require(msg.sender == creator, NotCreator());

        uint256 pool = configs[parentId].ticketCost * submissions[parentId].length + configs[parentId].creatorOffer;
        require(pool > 0, NothingToClaim());

        creatorFallbackClaimed[submarketId] = true;
        require(IERC20(USDC).transfer(creator, pool), TransferFailed());
        emit CreatorFallbackClaimed(submarketId, creator, pool);
    }

    // ── Batch operations ─────────────────────────────────────────────────────

    /**
     * @notice Batch reveal info phase for multiple submarkets in one transaction.
     * @dev Only callable by CRE forwarder.
     */
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
    ) external nonReentrant onlyCREForwarder {
        uint256 n = submarketIds.length;
        require(
            merkleRoots.length == n &&
            consensusOutcomes.length == n &&
            totalReserveYes.length == n &&
            totalReserveNo.length == n &&
            validSubmissions.length == n &&
            totalYesShares.length == n &&
            totalNoShares.length == n,
            "Length mismatch"
        );
        for (uint256 i = 0; i < n; i++) {
            _revealInfoPhase(
                submarketIds[i],
                merkleRoots[i],
                consensusOutcomes[i],
                totalReserveYes[i],
                totalReserveNo[i],
                validSubmissions[i],
                totalYesShares[i],
                totalNoShares[i],
                leavesURI
            );
        }
    }

    /**
     * @notice Batch resolve multiple submarkets in one transaction.
     * @dev Only callable by CRE forwarder.
     */
    function batchResolveMarket(
        bytes32[] calldata submarketIds,
        Outcome[] calldata outcomes
    ) external nonReentrant onlyCREForwarder {
        require(submarketIds.length == outcomes.length, "Length mismatch");
        for (uint256 i = 0; i < submarketIds.length; i++) {
            _resolveMarket(submarketIds[i], outcomes[i]);
        }
    }

    /**
     * @notice Batch set penalty factors for multiple submarkets.
     * @dev Only callable by CRE forwarder. Each agentsPerSubmarket[i] and factorsPerSubmarket[i]
     *      correspond to submarketIds[i].
     */
    function batchSetPenaltyFactors(
        bytes32[] calldata submarketIds,
        address[][] calldata agentsPerSubmarket,
        uint256[][] calldata factorsPerSubmarket
    ) external onlyCREForwarder {
        require(
            submarketIds.length == agentsPerSubmarket.length &&
            submarketIds.length == factorsPerSubmarket.length,
            "Length mismatch"
        );
        for (uint256 i = 0; i < submarketIds.length; i++) {
            bytes32 smId = submarketIds[i];
            address[] calldata agents = agentsPerSubmarket[i];
            uint256[] calldata factors = factorsPerSubmarket[i];
            require(agents.length == factors.length, "Inner length mismatch");
            for (uint256 j = 0; j < agents.length; j++) {
                require(factors[j] <= 10000, PenaltyFactorTooHigh());
                penaltyFactors[smId][agents[j]] = factors[j];
            }
        }
    }

    /**
     * @notice Claim payouts for multiple submarkets in a single transaction.
     * @dev Emits PayoutClaimed (and PenaltyCollected if applicable) for each submarket.
     *      Non-winners are silently skipped so the caller doesn't need to pre-filter.
     */
    function batchClaimPayout(bytes32[] calldata submarketIds) external nonReentrant {
        for (uint256 i = 0; i < submarketIds.length; i++) {
            bytes32 smId = submarketIds[i];
            if (submarketConfigs[smId].parentMarketId == 0) continue;

            MarketState storage state = submarketStates[smId];
            if (state.phase != MarketPhase.RESOLVED) continue;

            Outcome winningOutcome = state.resolvedOutcome;
            if (winningOutcome == Outcome.NONE) continue;

            AgentState storage subAgent = submarketAgentStates[smId][msg.sender];
            uint256 winningShares = winningOutcome == Outcome.YES ? subAgent.yesShares : subAgent.noShares;
            if (winningShares == 0) continue;

            uint256 totalWinning = winningOutcome == Outcome.YES
                ? state.totalClaimedYes
                : state.totalClaimedNo;
            if (totalWinning == 0) continue;

            uint256 parentId = submarketConfigs[smId].parentMarketId;
            MarketConfig storage parentConfig = configs[parentId];
            uint256 pool = parentConfig.ticketCost * submissions[parentId].length + parentConfig.creatorOffer;
            uint256 fullPayout = (winningShares * pool) / totalWinning;
            uint256 penalty = (fullPayout * penaltyFactors[smId][msg.sender]) / 10000;

            if (winningOutcome == Outcome.YES) { subAgent.yesShares = 0; } else { subAgent.noShares = 0; }

            if (fullPayout - penalty > 0) {
                require(IERC20(USDC).transfer(msg.sender, fullPayout - penalty), TransferFailed());
            }
            address creator = configs[parentId].creator;
            if (penalty > 0) {
                require(IERC20(USDC).transfer(creator, penalty), TransferFailed());
            }

            emit PayoutClaimed(smId, msg.sender, fullPayout - penalty);
            if (penalty > 0) {
                emit PenaltyCollected(smId, msg.sender, creator, penalty);
            }
        }
    }

    /**
     * @notice Claim initial shares for multiple submarkets in one transaction.
     * @dev Each proof must correspond to the submarket at the same index.
     */
    function batchClaimShares(
        bytes32[] calldata submarketIds,
        MerkleProof[] calldata proofs
    ) external nonReentrant {
        require(submarketIds.length == proofs.length, "Length mismatch");
        uint256 parentId;
        for (uint256 i = 0; i < submarketIds.length; i++) {
            bytes32 smId = submarketIds[i];
            require(submarketConfigs[smId].parentMarketId > 0, InvalidSubmarket());

            parentId = submarketConfigs[smId].parentMarketId;
            require(agentStates[parentId][msg.sender].participatedInInfo, NotInfoParticipant());

            MarketState storage state = submarketStates[smId];
            require(state.phase == MarketPhase.TRADING, InvalidPhase());

            AgentState storage subAgent = submarketAgentStates[smId][msg.sender];
            require(!subAgent.claimedInitialShares, AlreadyClaimedShares());

            MerkleProof calldata proof = proofs[i];
            require(proof.yesShares > 0 || proof.noShares > 0, "Zero shares");

            bytes32 leaf = keccak256(abi.encodePacked(proof.agent, proof.yesShares, proof.noShares));
            require(OZMerkleProof.verifyCalldata(proof.proof, proof.root, leaf), InvalidMerkleProof());
            require(proof.root == state.merkleRoot, "Root mismatch");
            require(proof.agent == msg.sender, "Agent mismatch");

            subAgent.claimedInitialShares = true;
            subAgent.yesShares += uint128(proof.yesShares);
            subAgent.noShares += uint128(proof.noShares);
            state.totalClaimedYes += uint128(proof.yesShares);
            state.totalClaimedNo += uint128(proof.noShares);

            emit SharesClaimed(smId, msg.sender, proof.yesShares, proof.noShares);
        }
    }

    // ── CRE onReport ───────────────────────────────────────────────────────────

    /// @inheritdoc IReceiver
    /// @dev Selector 0 = phase1 (reveal), selector 1 = phase2 (resolve).
    ///      Both use bytes32 submarketId in the encoded report.
    function onReport(
        bytes calldata /* metadata */,
        bytes calldata report
    ) external override nonReentrant onlyCREForwarder {
        uint8 selector = uint8(bytes1(report[31]));

        if (selector == 0) {
            (
                ,
                bytes32 submarketId,
                bytes32 merkleRoot,
                uint8 consensus,
                uint128 reserveYes,
                uint128 reserveNo,
                uint256 validSubmissions,
                uint128 totalYesShares,
                uint128 totalNoShares,
                string memory leavesURI
            ) = abi.decode(
                report,
                (uint8, bytes32, bytes32, uint8, uint128, uint128, uint256, uint128, uint128, string)
            );

            _revealInfoPhase(
                submarketId,
                merkleRoot,
                Outcome(consensus),
                reserveYes,
                reserveNo,
                validSubmissions,
                totalYesShares,
                totalNoShares,
                leavesURI
            );
        } else if (selector == 1) {
            (, bytes32 submarketId, uint8 outcome) = abi.decode(report, (uint8, bytes32, uint8));
            _resolveMarket(submarketId, Outcome(outcome));
        } else if (selector == 2) {
            // Batch phase1 reveal — all submarkets of a market in one report
            (
                ,
                bytes32[] memory smIds,
                bytes32[] memory roots,
                uint8[]   memory consensusOutcomes,
                uint128[] memory rYes,
                uint128[] memory rNo,
                uint256[] memory valids,
                uint128[] memory yShares,
                uint128[] memory nShares,
                string    memory uri
            ) = abi.decode(
                report,
                (uint8, bytes32[], bytes32[], uint8[], uint128[], uint128[], uint256[], uint128[], uint128[], string)
            );
            require(
                smIds.length == roots.length &&
                smIds.length == consensusOutcomes.length &&
                smIds.length == rYes.length &&
                smIds.length == rNo.length &&
                smIds.length == valids.length &&
                smIds.length == yShares.length &&
                smIds.length == nShares.length,
                "Length mismatch"
            );
            for (uint256 i = 0; i < smIds.length; i++) {
                _revealInfoPhase(smIds[i], roots[i], Outcome(consensusOutcomes[i]), rYes[i], rNo[i], valids[i], yShares[i], nShares[i], uri);
            }
        } else if (selector == 3) {
            // Batch phase2 resolve — all submarkets of a market in one report
            (, bytes32[] memory smIds, uint8[] memory outcomes) = abi.decode(report, (uint8, bytes32[], uint8[]));
            require(smIds.length == outcomes.length, "Length mismatch");
            for (uint256 i = 0; i < smIds.length; i++) {
                _resolveMarket(smIds[i], Outcome(outcomes[i]));
            }
        } else {
            revert InvalidReportSelector(selector);
        }
    }

    // ── Orderbook integration ─────────────────────────────────────────────────

    /**
     * @notice Execute a P2P trade from the orderbook (YES <-> NO shares only).
     * @dev Only callable by the orderbook.
     */
    function executeOrderbookTrade(
        bytes32 submarketId,
        address maker,
        address taker,
        bool makerSellsYes,
        uint256 sharesAmount,
        uint256 takerPaysAmount
    ) external nonReentrant validSubmarket(submarketId)
      inSubmarketPhase(submarketId, MarketPhase.TRADING)
      onlyOrderbook
    {
        require(sharesAmount > 0 && takerPaysAmount > 0, "Zero amount");
        require(maker != taker, "Same agent");

        AgentState storage makerState = submarketAgentStates[submarketId][maker];
        AgentState storage takerState = submarketAgentStates[submarketId][taker];

        require(makerState.claimedInitialShares, "Maker cannot trade");
        require(takerState.claimedInitialShares, "Taker cannot trade");

        if (makerSellsYes) {
            require(makerState.yesShares >= sharesAmount, InsufficientShares());
            require(takerState.noShares >= takerPaysAmount, InsufficientShares());

            makerState.yesShares -= uint128(sharesAmount);
            makerState.noShares += uint128(takerPaysAmount);
            takerState.yesShares += uint128(sharesAmount);
            takerState.noShares -= uint128(takerPaysAmount);
        } else {
            require(makerState.noShares >= sharesAmount, InsufficientShares());
            require(takerState.yesShares >= takerPaysAmount, InsufficientShares());

            makerState.noShares -= uint128(sharesAmount);
            makerState.yesShares += uint128(takerPaysAmount);
            takerState.noShares += uint128(sharesAmount);
            takerState.yesShares -= uint128(takerPaysAmount);
        }

        emit SharesSwapped(
            submarketId,
            maker,
            makerSellsYes ? Outcome.YES : Outcome.NO,
            makerSellsYes ? Outcome.NO : Outcome.YES,
            sharesAmount,
            takerPaysAmount
        );
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == type(IReceiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    function setAuthorizedSigner(address signer, bool authorized) external override onlyOwner {
        _authorizedSigners[signer] = authorized;
    }

    function setOrderbook(address _orderbook) external onlyOwner {
        orderbook = _orderbook;
    }

    // ── View functions ────────────────────────────────────────────────────────

    function isAuthorizedSigner(address signer) external view override returns (bool) {
        return _authorizedSigners[signer];
    }

    function getSubmission(uint256 marketId, uint256 index) external view returns (EncryptedSubmission memory) {
        return submissions[marketId][index];
    }

    function getSubmissionCount(uint256 marketId) external view returns (uint256) {
        return submissions[marketId].length;
    }

    function getAllSubmissions(uint256 marketId) external view returns (EncryptedSubmission[] memory) {
        return submissions[marketId];
    }

    function getPriceRatio(bytes32 submarketId) external view validSubmarket(submarketId)
        returns (uint256 priceYes, uint256 priceNo)
    {
        MarketState storage state = submarketStates[submarketId];
        (priceYes, priceNo) = ConstantSum.calculatePrices(state.reserveYes, state.reserveNo);
    }

    function calculateSwapOutput(
        bytes32 submarketId,
        Outcome burnOutcome,
        uint256 burnAmount
    ) external view validSubmarket(submarketId) returns (uint256 mintAmount) {
        MarketState storage state = submarketStates[submarketId];

        if (burnOutcome == Outcome.YES) {
            mintAmount = ConstantSum.calculateSwapOutput(state.reserveYes, state.reserveNo, burnAmount);
        } else {
            mintAmount = ConstantSum.calculateSwapOutput(state.reserveNo, state.reserveYes, burnAmount);
        }
    }

    function canTrade(bytes32 submarketId, address agent) external view validSubmarket(submarketId) returns (bool) {
        uint256 parentId = submarketConfigs[submarketId].parentMarketId;
        AgentState storage parentAgent = agentStates[parentId][agent];
        AgentState storage subAgent = submarketAgentStates[submarketId][agent];
        return parentAgent.participatedInInfo && subAgent.claimedInitialShares;
    }

    function isTradingActive(bytes32 submarketId) external view validSubmarket(submarketId) returns (bool) {
        return _getSubmarketPhase(submarketId) == MarketPhase.TRADING;
    }

    function creatorPremium(uint256 marketId) external view validMarket(marketId) returns (uint256) {
        return configs[marketId].creatorOffer;
    }

    function totalLiquidity(uint256 marketId) external view validMarket(marketId) returns (uint256) {
        MarketConfig storage config = configs[marketId];
        uint256 participantCount = submissions[marketId].length;
        return config.creatorOffer + config.ticketCost * participantCount;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _getSubmarketPhase(bytes32 submarketId) internal view returns (MarketPhase) {
        MarketState storage state = submarketStates[submarketId];

        if (state.phase == MarketPhase.RESOLVED) {
            return MarketPhase.RESOLVED;
        }

        if (state.phase == MarketPhase.TRADING) {
            uint256 tradingParentId = submarketConfigs[submarketId].parentMarketId;
            MarketConfig storage config = configs[tradingParentId];
            uint48 tradingEnd = config.createdAt + config.tradingDuration;
            if (block.timestamp >= tradingEnd) {
                return MarketPhase.RESOLVED;
            }
            return MarketPhase.TRADING;
        }

        // INFO_COLLECTION
        if (state.merkleRoot != bytes32(0)) {
            return MarketPhase.TRADING;
        }

        uint256 infoParentId = submarketConfigs[submarketId].parentMarketId;
        uint64 currentRound = _currentDrandRound();
        if (currentRound >= configs[infoParentId].drandTargetRound) {
            return MarketPhase.TRADING;
        }

        return MarketPhase.INFO_COLLECTION;
    }

    function _currentDrandRound() internal view returns (uint64) {
        return uint64((block.timestamp - DRAND_GENESIS) / DRAND_PERIOD);
    }
}
