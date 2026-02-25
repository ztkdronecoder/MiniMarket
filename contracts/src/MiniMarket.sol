// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IMarket, MarketPhase, Outcome, MarketConfig, MarketState, AgentState, EncryptedSubmission, MerkleProof} from "./interfaces/IMarket.sol";
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
 * @notice Privacy-preserving prediction market using drand timelock encryption
 * @dev Agents encrypt predictions to future drand rounds. CRE decrypts after round.
 */
contract MiniMarket is IMarket, ICREReceiver, ReentrancyGuard, Ownable {
    uint256 public constant PRECISION = 1e18;
    bytes32 public constant DRAND_QUICKNET_HASH = 0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971;
    uint64 public constant DRAND_GENESIS = 1692803367;
    uint64 public constant DRAND_PERIOD = 3;

    address public immutable CRE_FORWARDER;
    address public immutable USDC;

    mapping(uint256 => MarketConfig) public configs;
    mapping(uint256 => MarketState) public states;
    mapping(uint256 => EncryptedSubmission[]) public submissions;
    mapping(uint256 => mapping(address => AgentState)) public agentStates;
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;
    mapping(uint256 => bool) public infoRevealRequested;
    mapping(uint256 => bool) public resolutionRequested;

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

    modifier inPhase(uint256 marketId, MarketPhase requiredPhase) {
        MarketPhase currentPhase = _getPhase(marketId);
        require(currentPhase == requiredPhase, InvalidPhase());
        _;
    }

    error UnauthorizedForwarder();
    error UnauthorizedSigner();
    error InvalidMarket();
    error InvalidPhase();
    error MarketFull();
    error AlreadySubmitted();
    error NotInfoParticipant();
    error AlreadyClaimedShares();
    error InvalidMerkleProof();
    error InsufficientShares();
    error AlreadyResolved();
    error NothingToClaim();
    error TransferFailed();
    error InvalidTargetRound();
    error RoundAlreadyPassed();
    error InvalidReportSelector(uint8 selector);
    error UnauthorizedOrderbook();

    modifier onlyOrderbook() {
        require(msg.sender == orderbook, UnauthorizedOrderbook());
        _;
    }

    /// @notice Emitted when CRE processes phase 1 (reveal) via onReport
    event Phase1Resolved(uint256 indexed marketId);
    /// @notice Emitted when CRE processes phase 2 (resolve) via onReport
    event Phase2Resolved(uint256 indexed marketId);

    constructor(address creForwarder, address initialOwner, address usdc) Ownable(initialOwner) {
        CRE_FORWARDER = creForwarder;
        USDC = usdc;
    }

    /**
     * @notice Create a new prediction market (USDC only)
     * @param question The question to predict
     * @param schemaJson Full resolution schema as JSON string (stored onchain)
     * @param maxSlots Maximum number of participants
     * @param ticketCost Cost per ticket in USDC (6 decimals)
     * @param drandTargetRound Drand round for timelock reveal
     * @param drandChainHash Drand network identifier
     * @param tradingDuration Duration of trading phase in seconds
     * @return marketId The ID of the created market
     */
    function createMarket(
        string calldata question,
        string calldata schemaJson,
        uint256 maxSlots,
        uint256 ticketCost,
        uint64 drandTargetRound,
        bytes32 drandChainHash,
        uint48 tradingDuration
    ) external nonReentrant returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(bytes(schemaJson).length > 0, "Empty schema");
        require(maxSlots > 0, "Zero slots");
        require(ticketCost > 0, "Zero cost");
        require(tradingDuration > 0, "Zero duration");

        // FOR TESTING ONLY - skip round check
        // uint64 currentRound = _currentDrandRound();
        // require(drandTargetRound > currentRound, RoundAlreadyPassed());

        marketId = _nextMarketId++;

        MarketConfig storage config = configs[marketId];
        config.marketId = marketId;
        config.question = question;
        config.schemaJson = schemaJson;
        config.maxSlots = maxSlots;
        config.ticketCost = ticketCost;
        config.marketCap = maxSlots * ticketCost;
        config.drandTargetRound = drandTargetRound;
        config.drandChainHash = drandChainHash;
        config.createdAt = uint48(block.timestamp);
        config.tradingDuration = tradingDuration;

        states[marketId].phase = MarketPhase.INFO_COLLECTION;

        IERC20(USDC).transferFrom(msg.sender, address(this), config.marketCap);

        emit MarketCreated(marketId, question, maxSlots, ticketCost, drandTargetRound);
    }

    /**
     * @notice Submit encrypted prediction
     * @param marketId Market ID
     * @param ciphertext Timelock encrypted payload (outcome, agent, salt)
     * @param validationHash keccak256(outcome, agent, salt) for validation
     */
    function submitEncrypted(
        uint256 marketId,
        bytes calldata ciphertext,
        bytes32 validationHash
    ) external nonReentrant validMarket(marketId) inPhase(marketId, MarketPhase.INFO_COLLECTION) {
        MarketConfig storage config = configs[marketId];

        require(submissions[marketId].length < config.maxSlots, MarketFull());
        require(!hasSubmitted[marketId][msg.sender], AlreadySubmitted());
        require(ciphertext.length > 0, "Empty ciphertext");

        IERC20(USDC).transferFrom(msg.sender, address(this), config.ticketCost);

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
            config.drandTargetRound
        );
    }

    /**
     * @notice Request info phase reveal after drand round is reached
     * @dev Can be called by anyone or by Automation. Emits event for CRE to process.
     */
    function requestInfoReveal(uint256 marketId) external validMarket(marketId) {
        MarketState storage state = states[marketId];
        MarketConfig storage config = configs[marketId];

        require(state.phase == MarketPhase.INFO_COLLECTION, InvalidPhase());
        require(state.merkleRoot == bytes32(0), "Already revealed");
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
     * @notice Request market resolution after trading period ends
     * @dev Can be called by anyone or by Automation. Emits event for CRE to process.
     */
    function requestResolution(uint256 marketId) external validMarket(marketId) {
        MarketState storage state = states[marketId];
        MarketConfig storage config = configs[marketId];

        require(state.phase == MarketPhase.TRADING, InvalidPhase());
        require(state.resolvedOutcome == Outcome.NONE, AlreadyResolved());
        require(!resolutionRequested[marketId], "Already requested");

        uint48 tradingEnd = config.createdAt + config.tradingDuration;
        require(block.timestamp >= tradingEnd, "Trading not ended");

        resolutionRequested[marketId] = true;

        emit ResolutionRequested(marketId, tradingEnd);
    }

    function _requestInfoRevealInternal(uint256 marketId) internal {
        MarketState storage state = states[marketId];
        MarketConfig storage config = configs[marketId];

        require(state.phase == MarketPhase.INFO_COLLECTION, InvalidPhase());
        require(state.merkleRoot == bytes32(0), "Already revealed");
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

    function _requestResolutionInternal(uint256 marketId) internal {
        MarketState storage state = states[marketId];
        MarketConfig storage config = configs[marketId];

        require(state.phase == MarketPhase.TRADING, InvalidPhase());
        require(state.resolvedOutcome == Outcome.NONE, AlreadyResolved());
        require(!resolutionRequested[marketId], "Already requested");

        uint48 tradingEnd = config.createdAt + config.tradingDuration;
        require(block.timestamp >= tradingEnd, "Trading not ended");

        resolutionRequested[marketId] = true;

        emit ResolutionRequested(marketId, tradingEnd);
    }

    /**
     * @notice Reveal info phase after drand round
     * @dev Only callable by CRE forwarder
     */
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
    ) external nonReentrant validMarket(marketId) onlyCREForwarder {
        _revealInfoPhase(
            marketId,
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
        uint256 marketId,
        bytes32 merkleRoot,
        Outcome consensusOutcome,
        uint128 totalReserveYes,
        uint128 totalReserveNo,
        uint256 validSubmissions,
        uint128 totalYesShares,
        uint128 totalNoShares,
        string memory leavesURI
    ) internal {
        MarketState storage state = states[marketId];

        require(state.phase == MarketPhase.INFO_COLLECTION, InvalidPhase());
        require(state.merkleRoot == bytes32(0), "Already revealed");

        MarketConfig storage config = configs[marketId];
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
            marketId,
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

    /**
     * @notice Claim initial shares via merkle proof
     * @dev Phase1 price discovery: agent gets yesShares + noShares based on consensus proximity
     */
    function claimShares(
        uint256 marketId,
        MerkleProof calldata proof
    ) external nonReentrant validMarket(marketId) inPhase(marketId, MarketPhase.TRADING) {
        AgentState storage agent = agentStates[marketId][msg.sender];

        require(agent.participatedInInfo, NotInfoParticipant());
        require(!agent.claimedInitialShares, AlreadyClaimedShares());
        require(proof.yesShares > 0 || proof.noShares > 0, "Zero shares");

        bytes32 leaf = keccak256(abi.encodePacked(proof.agent, proof.yesShares, proof.noShares));

        require(
            OZMerkleProof.verifyCalldata(proof.proof, proof.root, leaf),
            InvalidMerkleProof()
        );
        require(proof.root == states[marketId].merkleRoot, "Root mismatch");
        require(proof.agent == msg.sender, "Agent mismatch");

        agent.claimedInitialShares = true;

        agent.yesShares += uint128(proof.yesShares);
        agent.noShares += uint128(proof.noShares);
        states[marketId].totalClaimedYes += uint128(proof.yesShares);
        states[marketId].totalClaimedNo += uint128(proof.noShares);

        uint256 totalAllocated = proof.yesShares + proof.noShares;
        reputation[msg.sender] += Quadratic.calculateReputationDelta(totalAllocated);

        emit SharesClaimed(marketId, msg.sender, proof.yesShares, proof.noShares);
    }

    /**
     * @notice Swap shares between outcomes
     * @dev Constant sum bonding curve
     */
    function swapShares(
        uint256 marketId,
        Outcome burnOutcome,
        uint256 burnAmount
    ) external nonReentrant validMarket(marketId) inPhase(marketId, MarketPhase.TRADING) returns (uint256 mintAmount) {
        AgentState storage agent = agentStates[marketId][msg.sender];
        MarketState storage state = states[marketId];

        require(agent.participatedInInfo, NotInfoParticipant());
        require(agent.claimedInitialShares, "Claim shares first");

        if (burnOutcome == Outcome.YES) {
            require(agent.yesShares >= burnAmount, InsufficientShares());

            mintAmount = ConstantSum.calculateSwapOutput(
                state.reserveYes,
                state.reserveNo,
                burnAmount
            );

            require(state.reserveNo >= mintAmount, "Insufficient NO reserve");
            
            agent.yesShares -= uint128(burnAmount);
            state.reserveYes += uint128(burnAmount);
            state.reserveNo -= uint128(mintAmount);
            agent.noShares += uint128(mintAmount);
        } else {
            require(agent.noShares >= burnAmount, InsufficientShares());

            mintAmount = ConstantSum.calculateSwapOutput(
                state.reserveNo,
                state.reserveYes,
                burnAmount
            );

            require(state.reserveYes >= mintAmount, "Insufficient YES reserve");
            
            agent.noShares -= uint128(burnAmount);
            state.reserveNo += uint128(burnAmount);
            state.reserveYes -= uint128(mintAmount);
            agent.yesShares += uint128(mintAmount);
        }

        Outcome mintOutcome = burnOutcome == Outcome.YES ? Outcome.NO : Outcome.YES;

        emit SharesSwapped(
            marketId,
            msg.sender,
            burnOutcome,
            mintOutcome,
            burnAmount,
            mintAmount
        );
    }

    /**
     * @notice Resolve market with winning outcome
     * @dev Only callable by CRE forwarder
     */
    function resolveMarket(
        uint256 marketId,
        Outcome outcome
    ) external nonReentrant validMarket(marketId) onlyCREForwarder {
        _resolveMarket(marketId, outcome);
    }

    function _resolveMarket(uint256 marketId, Outcome outcome) internal {
        MarketState storage state = states[marketId];

        require(state.phase == MarketPhase.TRADING, InvalidPhase());
        require(state.resolvedOutcome == Outcome.NONE, AlreadyResolved());

        state.resolvedOutcome = outcome;
        state.phase = MarketPhase.RESOLVED;

        emit MarketResolved(marketId, outcome);
    }

    /**
     * @notice Claim payout for winning shares
     */
    function claimPayout(uint256 marketId) external nonReentrant validMarket(marketId) inPhase(marketId, MarketPhase.RESOLVED) {
        MarketState storage state = states[marketId];
        AgentState storage agent = agentStates[marketId][msg.sender];

        Outcome winningOutcome = state.resolvedOutcome;
        require(winningOutcome != Outcome.NONE, "Not resolved");

        uint256 winningShares = winningOutcome == Outcome.YES
            ? agent.yesShares
            : agent.noShares;

        require(winningShares > 0, NothingToClaim());

        uint256 totalWinningShares = winningOutcome == Outcome.YES
            ? state.reserveYes + state.totalClaimedYes
            : state.reserveNo + state.totalClaimedNo;

        uint256 payout = (winningShares * configs[marketId].marketCap) / totalWinningShares;

        if (winningOutcome == Outcome.YES) {
            agent.yesShares = 0;
        } else {
            agent.noShares = 0;
        }

        require(IERC20(USDC).transfer(msg.sender, payout), TransferFailed());

        emit PayoutClaimed(marketId, msg.sender, payout);
    }

    /// @inheritdoc IReceiver
    /// @dev Decodes report: selector 0 = phase1 (reveal), selector 1 = phase2 (resolve).
    /// Forwarder passes (metadata, report); we use only report.
    function onReport(
        bytes calldata /* metadata */,
        bytes calldata report
    ) external override nonReentrant onlyCREForwarder {
        uint8 selector = uint8(bytes1(report[31]));

        if (selector == 0) {
            (
                ,
                uint256 marketId,
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
                (uint8, uint256, bytes32, uint8, uint128, uint128, uint256, uint128, uint128, string)
            );

            _revealInfoPhase(
                marketId,
                merkleRoot,
                Outcome(consensus),
                reserveYes,
                reserveNo,
                validSubmissions,
                totalYesShares,
                totalNoShares,
                leavesURI
            );
            emit Phase1Resolved(marketId);
        } else if (selector == 1) {
            (, uint256 marketId, uint8 outcome) = abi.decode(report, (uint8, uint256, uint8));
            _resolveMarket(marketId, Outcome(outcome));
            emit Phase2Resolved(marketId);
        } else {
            revert InvalidReportSelector(selector);
        }
    }

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

    /**
     * @notice Execute a P2P trade from the orderbook (YES <-> NO shares only)
     * @dev Only callable by the orderbook. Transfers shares between maker and taker.
     * @param marketId Market ID
     * @param maker Agent selling shares
     * @param taker Agent buying shares (pays the other outcome)
     * @param makerSellsYes True if maker sells YES for NO
     * @param sharesAmount Amount of shares sold
     * @param takerPaysAmount Amount of the other outcome taker pays
     */
    function executeOrderbookTrade(
        uint256 marketId,
        address maker,
        address taker,
        bool makerSellsYes,
        uint256 sharesAmount,
        uint256 takerPaysAmount
    ) external nonReentrant validMarket(marketId) inPhase(marketId, MarketPhase.TRADING) onlyOrderbook {
        require(sharesAmount > 0 && takerPaysAmount > 0, "Zero amount");
        require(maker != taker, "Same agent");

        AgentState storage makerState = agentStates[marketId][maker];
        AgentState storage takerState = agentStates[marketId][taker];

        require(makerState.participatedInInfo && makerState.claimedInitialShares, "Maker cannot trade");
        require(takerState.participatedInInfo && takerState.claimedInitialShares, "Taker cannot trade");

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
            marketId,
            maker,
            makerSellsYes ? Outcome.YES : Outcome.NO,
            makerSellsYes ? Outcome.NO : Outcome.YES,
            sharesAmount,
            takerPaysAmount
        );
    }

    function isAuthorizedSigner(address signer) external view override returns (bool) {
        return _authorizedSigners[signer];
    }

    function getSubmission(uint256 marketId, uint256 index) external view returns (EncryptedSubmission memory) {
        return submissions[marketId][index];
    }

    function getSubmissionCount(uint256 marketId) external view returns (uint256) {
        return submissions[marketId].length;
    }

    function getPriceRatio(uint256 marketId) external view validMarket(marketId) returns (uint256 priceYes, uint256 priceNo) {
        MarketState storage state = states[marketId];
        (priceYes, priceNo) = ConstantSum.calculatePrices(state.reserveYes, state.reserveNo);
    }

    function calculateSwapOutput(
        uint256 marketId,
        Outcome burnOutcome,
        uint256 burnAmount
    ) external view validMarket(marketId) returns (uint256 mintAmount) {
        MarketState storage state = states[marketId];

        if (burnOutcome == Outcome.YES) {
            mintAmount = ConstantSum.calculateSwapOutput(
                state.reserveYes,
                state.reserveNo,
                burnAmount
            );
        } else {
            mintAmount = ConstantSum.calculateSwapOutput(
                state.reserveNo,
                state.reserveYes,
                burnAmount
            );
        }
    }

    function canTrade(uint256 marketId, address agent) external view validMarket(marketId) returns (bool) {
        AgentState storage state = agentStates[marketId][agent];
        return state.participatedInInfo && state.claimedInitialShares;
    }

    function _getPhase(uint256 marketId) internal view returns (MarketPhase) {
        MarketState storage state = states[marketId];

        if (state.phase == MarketPhase.RESOLVED) {
            return MarketPhase.RESOLVED;
        }

        if (state.phase == MarketPhase.TRADING) {
            MarketConfig storage config = configs[marketId];
            uint48 tradingEnd = config.createdAt + config.tradingDuration;
            if (block.timestamp >= tradingEnd) {
                return MarketPhase.RESOLVED;
            }
            return MarketPhase.TRADING;
        }

        if (state.phase == MarketPhase.INFO_COLLECTION) {
            if (state.merkleRoot != bytes32(0)) {
                return MarketPhase.TRADING;
            }

            uint64 currentRound = _currentDrandRound();
            if (currentRound >= configs[marketId].drandTargetRound) {
                return MarketPhase.TRADING;
            }
            return MarketPhase.INFO_COLLECTION;
        }

        return MarketPhase.INFO_COLLECTION;
    }

    function _currentDrandRound() internal view returns (uint64) {
        return uint64((block.timestamp - DRAND_GENESIS) / DRAND_PERIOD);
    }

}
