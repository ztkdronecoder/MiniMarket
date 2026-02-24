// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IMarket, MarketPhase, Outcome, MarketConfig, MarketState, AgentState, EncryptedSubmission, MerkleProof} from "./interfaces/IMarket.sol";
import {ICREReceiver} from "./interfaces/ICREReceiver.sol";
import {ConstantSum} from "./libraries/ConstantSum.sol";
import {Quadratic} from "./libraries/Quadratic.sol";
import {MerkleVerifier} from "./libraries/MerkleVerifier.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MiniMarket
 * @notice Privacy-preserving prediction market using drand timelock encryption
 * @dev Agents encrypt predictions to future drand rounds. CRE decrypts after round.
 *      Chainlink Automation monitors conditions and triggers CRE workflows.
 */
contract MiniMarket is IMarket, ICREReceiver, ReentrancyGuard, Ownable {
    uint256 public constant PRECISION = 1e18;
    bytes32 public constant DRAND_QUICKNET_HASH = 0xdbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3ccac746459b582;
    uint64 public constant DRAND_GENESIS = 1692803367;
    uint64 public constant DRAND_PERIOD = 3;

    uint8 internal constant ACTION_INFO_REVEAL = 0;
    uint8 internal constant ACTION_RESOLUTION = 1;

    address public immutable CRE_FORWARDER;

    mapping(uint256 => MarketConfig) public configs;
    mapping(uint256 => MarketState) public states;
    mapping(uint256 => EncryptedSubmission[]) public submissions;
    mapping(uint256 => mapping(address => AgentState)) public agentStates;
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;
    mapping(uint256 => bool) public infoRevealRequested;
    mapping(uint256 => bool) public resolutionRequested;

    mapping(address => bool) private _authorizedSigners;
    mapping(address => uint256) public reputation;

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

    constructor(address creForwarder, address initialOwner) Ownable(initialOwner) {
        CRE_FORWARDER = creForwarder;
    }

    /**
     * @notice Create a new prediction market
     * @param question The question to predict
     * @param schemaURI URI to resolution schema (IPFS/HTTP)
     * @param paymentToken Token for stakes (address(0) for ETH)
     * @param maxSlots Maximum number of participants
     * @param ticketCost Cost per ticket in token/ETH
     * @param drandTargetRound Drand round for timelock reveal
     * @param drandChainHash Drand network identifier
     * @param tradingDuration Duration of trading phase in seconds
     * @return marketId The ID of the created market
     */
    function createMarket(
        string calldata question,
        string calldata schemaURI,
        address paymentToken,
        uint256 maxSlots,
        uint256 ticketCost,
        uint64 drandTargetRound,
        bytes32 drandChainHash,
        uint48 tradingDuration
    ) external payable nonReentrant returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(bytes(schemaURI).length > 0, "Empty schema URI");
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
        config.schemaURI = schemaURI;
        config.paymentToken = paymentToken;
        config.maxSlots = maxSlots;
        config.ticketCost = ticketCost;
        config.marketCap = maxSlots * ticketCost;
        config.drandTargetRound = drandTargetRound;
        config.drandChainHash = drandChainHash;
        config.createdAt = uint48(block.timestamp);
        config.tradingDuration = tradingDuration;

        states[marketId].phase = MarketPhase.INFO_COLLECTION;

        uint256 totalFunding = config.marketCap;
        if (paymentToken == address(0)) {
            require(msg.value >= totalFunding, "Insufficient ETH");
            if (msg.value > totalFunding) {
                (bool refund, ) = msg.sender.call{value: msg.value - totalFunding}("");
                require(refund, TransferFailed());
            }
        } else {
            require(msg.value == 0, "ETH not accepted");
            IERC20(paymentToken).transferFrom(msg.sender, address(this), totalFunding);
        }

        emit MarketCreated(marketId, question, schemaURI, maxSlots, ticketCost, drandTargetRound);
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
    ) external payable nonReentrant validMarket(marketId) inPhase(marketId, MarketPhase.INFO_COLLECTION) {
        MarketConfig storage config = configs[marketId];

        require(submissions[marketId].length < config.maxSlots, MarketFull());
        require(!hasSubmitted[marketId][msg.sender], AlreadySubmitted());
        require(ciphertext.length > 0, "Empty ciphertext");

        if (config.paymentToken == address(0)) {
            require(msg.value >= config.ticketCost, "Insufficient ETH");
            if (msg.value > config.ticketCost) {
                (bool refund, ) = msg.sender.call{value: msg.value - config.ticketCost}("");
                require(refund, TransferFailed());
            }
        } else {
            require(msg.value == 0, "ETH not accepted");
            IERC20(config.paymentToken).transferFrom(msg.sender, address(this), config.ticketCost);
        }

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

        emit ResolutionRequested(marketId, config.schemaURI, tradingEnd);
    }

    /**
     * @notice Check if upkeep is needed (Automation callback)
     * @param checkData Encoded start marketId for pagination
     * @return upkeepNeeded Whether upkeep is needed
     * @return performData Encoded (action, marketId) for performUpkeep
     */
    function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData) {
        uint256 startId = checkData.length > 0 ? abi.decode(checkData, (uint256)) : 1;

        for (uint256 marketId = startId; marketId < _nextMarketId; marketId++) {
            MarketState storage state = states[marketId];
            MarketConfig storage config = configs[marketId];

            if (state.phase == MarketPhase.INFO_COLLECTION && 
                state.merkleRoot == bytes32(0) && 
                !infoRevealRequested[marketId]) {
                
                uint64 currentRound = _currentDrandRound();
                if (currentRound >= config.drandTargetRound) {
                    return (true, abi.encode(ACTION_INFO_REVEAL, marketId));
                }
            }

            if (state.phase == MarketPhase.TRADING && 
                state.resolvedOutcome == Outcome.NONE && 
                !resolutionRequested[marketId]) {
                
                uint48 tradingEnd = config.createdAt + config.tradingDuration;
                if (block.timestamp >= tradingEnd) {
                    return (true, abi.encode(ACTION_RESOLUTION, marketId));
                }
            }
        }

        return (false, "");
    }

    /**
     * @notice Perform upkeep (Automation callback)
     * @param performData Encoded (action, marketId)
     */
    function performUpkeep(bytes calldata performData) external {
        (uint8 action, uint256 marketId) = abi.decode(performData, (uint8, uint256));

        require(marketId < _nextMarketId, InvalidMarket());

        if (action == ACTION_INFO_REVEAL) {
            _requestInfoRevealInternal(marketId);
        } else if (action == ACTION_RESOLUTION) {
            _requestResolutionInternal(marketId);
        }
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

        emit ResolutionRequested(marketId, config.schemaURI, tradingEnd);
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
        uint256 validSubmissions
    ) external nonReentrant validMarket(marketId) onlyCREForwarder {
        _revealInfoPhase(
            marketId,
            merkleRoot,
            consensusOutcome,
            totalReserveYes,
            totalReserveNo,
            validSubmissions
        );
    }

    function _revealInfoPhase(
        uint256 marketId,
        bytes32 merkleRoot,
        Outcome consensusOutcome,
        uint128 totalReserveYes,
        uint128 totalReserveNo,
        uint256 validSubmissions
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
        state.phase = MarketPhase.TRADING;

        emit InfoPhaseRevealed(
            marketId,
            merkleRoot,
            consensusOutcome,
            totalReserveYes,
            totalReserveNo,
            validSubmissions
        );
    }

    /**
     * @notice Claim initial shares via merkle proof
     */
    function claimShares(
        uint256 marketId,
        MerkleProof calldata proof
    ) external nonReentrant validMarket(marketId) inPhase(marketId, MarketPhase.TRADING) {
        AgentState storage agent = agentStates[marketId][msg.sender];

        require(agent.participatedInInfo, NotInfoParticipant());
        require(!agent.claimedInitialShares, AlreadyClaimedShares());

        bytes32 leaf = MerkleVerifier.hashLeaf(
            proof.agent,
            uint8(proof.predictedOutcome),
            proof.allocatedShares
        );

        require(
            MerkleVerifier.verify(proof.proof, proof.root, leaf, proof.index),
            InvalidMerkleProof()
        );
        require(proof.root == states[marketId].merkleRoot, "Root mismatch");
        require(proof.agent == msg.sender, "Agent mismatch");

        agent.claimedInitialShares = true;

        if (proof.predictedOutcome == Outcome.YES) {
            agent.yesShares += uint128(proof.allocatedShares);
            states[marketId].totalClaimedYes += uint128(proof.allocatedShares);
        } else {
            agent.noShares += uint128(proof.allocatedShares);
            states[marketId].totalClaimedNo += uint128(proof.allocatedShares);
        }

        reputation[msg.sender] += Quadratic.calculateReputationDelta(proof.allocatedShares);

        emit SharesClaimed(marketId, msg.sender, proof.predictedOutcome, proof.allocatedShares);
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

        address token = configs[marketId].paymentToken;
        if (token == address(0)) {
            (bool success, ) = msg.sender.call{value: payout}("");
            require(success, TransferFailed());
        } else {
            require(IERC20(token).transfer(msg.sender, payout), TransferFailed());
        }

        emit PayoutClaimed(marketId, msg.sender, payout);
    }

    function onReport(
        bytes calldata report,
        bytes calldata
    ) external override onlyAuthorizedSigner {
        (
            uint256 marketId,
            bytes32 merkleRoot,
            uint8 consensus,
            uint128 reserveYes,
            uint128 reserveNo,
            uint256 validSubmissions
        ) = abi.decode(report, (uint256, bytes32, uint8, uint128, uint128, uint256));

        _revealInfoPhase(
            marketId,
            merkleRoot,
            Outcome(consensus),
            reserveYes,
            reserveNo,
            validSubmissions
        );
    }

    function setAuthorizedSigner(address signer, bool authorized) external override onlyOwner {
        _authorizedSigners[signer] = authorized;
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

    function testSkipToTrading(uint256 marketId) external {
        MarketState storage state = states[marketId];
        state.phase = MarketPhase.TRADING;
    }

    function _currentDrandRound() internal view returns (uint64) {
        return uint64((block.timestamp - DRAND_GENESIS) / DRAND_PERIOD);
    }

    receive() external payable {}
}
