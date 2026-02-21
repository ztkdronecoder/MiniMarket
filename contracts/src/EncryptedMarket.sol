// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IMarket, MarketPhase, Outcome, MarketConfig, MarketState, AgentState, MerkleProof} from "./interfaces/IMarket.sol";
import {ICREReceiver} from "./interfaces/ICREReceiver.sol";
import {ConstantSum} from "./libraries/ConstantSum.sol";
import {Quadratic} from "./libraries/Quadratic.sol";
import {MerkleVerifier} from "./libraries/MerkleVerifier.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract EncryptedMarket is IMarket, ICREReceiver, ReentrancyGuard, Ownable {
    using ConstantSum for uint256;
    using Quadratic for uint256;

    uint256 public constant PRECISION = 1e18;
    
    address public immutable CRE_FORWARDER;
    
    mapping(uint256 => MarketConfig) public configs;
    mapping(uint256 => MarketState) public states;
    mapping(uint256 => mapping(address => AgentState)) public agentStates;
    mapping(uint256 => mapping(address => bytes32)) public commitments;
    mapping(uint256 => uint256) public commitmentCount;
    
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
    error AlreadyCommitted();
    error NotInfoParticipant();
    error AlreadyClaimedShares();
    error InvalidMerkleProof();
    error InsufficientShares();
    error AlreadyResolved();
    error NothingToClaim();
    error TransferFailed();

    constructor(address creForwarder, address initialOwner) Ownable(initialOwner) {
        CRE_FORWARDER = creForwarder;
    }

    function createMarket(
        string calldata question,
        address paymentToken,
        uint256 maxSlots,
        uint256 ticketCost,
        uint48 infoPhaseDuration,
        uint48 tradingDuration
    ) external nonReentrant returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(maxSlots > 0, "Zero slots");
        require(ticketCost > 0, "Zero cost");
        require(infoPhaseDuration > 0, "Zero info duration");
        require(tradingDuration > 0, "Zero trading duration");

        marketId = _nextMarketId++;
        
        MarketConfig storage config = configs[marketId];
        config.marketId = marketId;
        config.question = question;
        config.paymentToken = paymentToken;
        config.maxSlots = maxSlots;
        config.ticketCost = ticketCost;
        config.marketCap = maxSlots * ticketCost;
        config.infoPhaseStart = uint48(block.timestamp);
        config.infoPhaseDuration = infoPhaseDuration;
        config.tradingDuration = tradingDuration;

        states[marketId].phase = MarketPhase.INFO_COLLECTION;

        if (paymentToken != address(0)) {
            IERC20(paymentToken).transferFrom(msg.sender, address(this), config.marketCap);
        }

        emit MarketCreated(
            marketId,
            question,
            maxSlots,
            ticketCost,
            uint48(block.timestamp) + infoPhaseDuration
        );
    }

    function submitCommitment(
        uint256 marketId,
        bytes32 commitmentHash
    ) external payable nonReentrant validMarket(marketId) inPhase(marketId, MarketPhase.INFO_COLLECTION) {
        MarketConfig storage config = configs[marketId];
        
        require(commitmentCount[marketId] < config.maxSlots, MarketFull());
        require(commitments[marketId][msg.sender] == bytes32(0), AlreadyCommitted());

        if (config.paymentToken == address(0)) {
            require(msg.value >= config.ticketCost, "Insufficient ETH");
        } else {
            IERC20(config.paymentToken).transferFrom(msg.sender, address(this), config.ticketCost);
        }

        commitments[marketId][msg.sender] = commitmentHash;
        commitmentCount[marketId]++;
        
        agentStates[marketId][msg.sender].participatedInInfo = true;

        emit EncryptedPredictionSubmitted(marketId, msg.sender, commitmentHash);
    }

    function revealInfoPhase(
        uint256 marketId,
        bytes32 merkleRoot,
        Outcome consensusOutcome,
        uint128 totalReserveYes,
        uint128 totalReserveNo
    ) external nonReentrant validMarket(marketId) onlyCREForwarder {
        MarketState storage state = states[marketId];
        
        require(state.phase == MarketPhase.INFO_COLLECTION, InvalidPhase());
        require(state.merkleRoot == bytes32(0), "Already revealed");

        uint48 infoEnd = configs[marketId].infoPhaseStart + configs[marketId].infoPhaseDuration;
        require(block.timestamp >= infoEnd, "Info phase not ended");

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
            totalReserveNo
        );
    }

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
            agent.yesShares -= uint128(burnAmount);
            state.reserveYes -= uint128(burnAmount);
            
            mintAmount = ConstantSum.calculateSwapOutput(
                state.reserveYes,
                state.reserveNo,
                burnAmount
            );
            
            require(state.reserveNo >= mintAmount, "Insufficient NO reserve");
            state.reserveNo -= uint128(mintAmount);
            agent.noShares += uint128(mintAmount);
        } else {
            require(agent.noShares >= burnAmount, InsufficientShares());
            agent.noShares -= uint128(burnAmount);
            state.reserveNo -= uint128(burnAmount);
            
            mintAmount = ConstantSum.calculateSwapOutput(
                state.reserveNo,
                state.reserveYes,
                burnAmount
            );
            
            require(state.reserveYes >= mintAmount, "Insufficient YES reserve");
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
        bytes calldata extraData
    ) external override onlyAuthorizedSigner {
        (uint256 marketId, bytes32 merkleRoot, uint8 consensus, uint128 reserveYes, uint128 reserveNo) = 
            abi.decode(report, (uint256, bytes32, uint8, uint128, uint128));
        
        revealInfoPhase(
            marketId,
            merkleRoot,
            Outcome(consensus),
            reserveYes,
            reserveNo
        );
    }

    function setAuthorizedSigner(address signer, bool authorized) external override onlyOwner {
        _authorizedSigners[signer] = authorized;
    }

    function isAuthorizedSigner(address signer) external view override returns (bool) {
        return _authorizedSigners[signer];
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
            uint48 tradingEnd = config.infoPhaseStart + config.infoPhaseDuration + config.tradingDuration;
            if (block.timestamp >= tradingEnd) {
                return MarketPhase.RESOLVED;
            }
            return MarketPhase.TRADING;
        }
        
        if (state.phase == MarketPhase.INFO_COLLECTION) {
            if (state.merkleRoot != bytes32(0)) {
                return MarketPhase.TRADING;
            }
            MarketConfig storage config = configs[marketId];
            uint48 infoEnd = config.infoPhaseStart + config.infoPhaseDuration;
            if (block.timestamp >= infoEnd) {
                return MarketPhase.TRADING;
            }
            return MarketPhase.INFO_COLLECTION;
        }
        
        return MarketPhase.INFO_COLLECTION;
    }

    receive() external payable {}
}
