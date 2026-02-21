// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {EncryptedMarket} from "../src/EncryptedMarket.sol";
import {IMarket, MarketPhase, Outcome, MarketConfig, MarketState, AgentState, MerkleProof} from "../src/interfaces/IMarket.sol";
import {ConstantSum} from "../src/libraries/ConstantSum.sol";
import {Quadratic} from "../src/libraries/Quadratic.sol";
import {MerkleVerifier} from "../src/libraries/MerkleVerifier.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract EncryptedMarketTest is Test {
    EncryptedMarket public market;
    MockERC20 public token;

    address public owner = address(0x1);
    address public creForwarder = address(0x2);
    address public agentA = address(0x10);
    address public agentB = address(0x11);
    address public agentC = address(0x12);
    address public unauthorized = address(0x99);

    uint256 public constant TICKET_COST = 10 * 1e18;
    uint256 public constant MAX_SLOTS = 100;
    uint48 public constant INFO_DURATION = 1 hours;
    uint48 public constant TRADING_DURATION = 24 hours;

    event MarketCreated(
        uint256 indexed marketId,
        string question,
        uint256 maxSlots,
        uint256 ticketCost,
        uint48 infoPhaseEnd
    );

    event EncryptedPredictionSubmitted(
        uint256 indexed marketId,
        address indexed agent,
        bytes32 commitmentHash
    );

    event SharesSwapped(
        uint256 indexed marketId,
        address indexed agent,
        Outcome burnedOutcome,
        Outcome mintedOutcome,
        uint256 burnAmount,
        uint256 mintAmount
    );

    function setUp() public {
        vm.startPrank(owner);
        market = new EncryptedMarket(creForwarder, owner);
        token = new MockERC20();
        vm.stopPrank();

        vm.deal(agentA, 100 ether);
        vm.deal(agentB, 100 ether);
        vm.deal(agentC, 100 ether);
    }

    function test_CreateMarket() public {
        vm.startPrank(owner);
        token.approve(address(market), TICKET_COST * MAX_SLOTS);

        vm.expectEmit(true, false, false, true);
        emit MarketCreated(
            1,
            "Will ETH > $4000 by Mar 1?",
            MAX_SLOTS,
            TICKET_COST,
            uint48(block.timestamp) + INFO_DURATION
        );

        uint256 marketId = market.createMarket(
            "Will ETH > $4000 by Mar 1?",
            address(token),
            MAX_SLOTS,
            TICKET_COST,
            INFO_DURATION,
            TRADING_DURATION
        );

        assertEq(marketId, 1);

        MarketConfig memory config = market.configs(marketId);
        assertEq(config.marketId, 1);
        assertEq(config.question, "Will ETH > $4000 by Mar 1?");
        assertEq(config.paymentToken, address(token));
        assertEq(config.maxSlots, MAX_SLOTS);
        assertEq(config.ticketCost, TICKET_COST);
        assertEq(config.marketCap, MAX_SLOTS * TICKET_COST);

        MarketState memory state = market.states(marketId);
        assertEq(uint256(state.phase), uint256(MarketPhase.INFO_COLLECTION));

        vm.stopPrank();
    }

    function test_SubmitCommitment() public {
        uint256 marketId = _createMarket();

        bytes32 commitment = keccak256(abi.encodePacked(Outcome.YES, uint256(12345)));

        vm.startPrank(agentA);
        token.approve(address(market), TICKET_COST);

        vm.expectEmit(true, true, false, true);
        emit EncryptedPredictionSubmitted(marketId, agentA, commitment);

        market.submitCommitment(marketId, commitment);

        assertEq(market.commitments(marketId, agentA), commitment);
        assertEq(market.commitmentCount(marketId), 1);

        AgentState memory state = market.agentStates(marketId, agentA);
        assertTrue(state.participatedInInfo);

        vm.stopPrank();
    }

    function test_SubmitCommitmentETH() public {
        vm.startPrank(owner);
        market = new EncryptedMarket(creForwarder, owner);
        uint256 marketId = market.createMarket(
            "ETH market",
            address(0),
            MAX_SLOTS,
            1 ether,
            INFO_DURATION,
            TRADING_DURATION
        );
        vm.stopPrank();

        bytes32 commitment = keccak256(abi.encodePacked(Outcome.YES, uint256(12345)));

        vm.startPrank(agentA);
        market.submitCommitment{value: 1 ether}(marketId, commitment);

        assertEq(market.commitments(marketId, agentA), commitment);
        vm.stopPrank();
    }

    function test_RevertWhen_MarketFull() public {
        uint256 marketId = _createMarketWithSmallSlots(2);

        bytes32 commitment1 = keccak256("1");
        bytes32 commitment2 = keccak256("2");
        bytes32 commitment3 = keccak256("3");

        vm.startPrank(agentA);
        token.approve(address(market), TICKET_COST * 3);
        market.submitCommitment(marketId, commitment1);
        vm.stopPrank();

        vm.startPrank(agentB);
        token.approve(address(market), TICKET_COST * 3);
        market.submitCommitment(marketId, commitment2);
        vm.stopPrank();

        vm.startPrank(agentC);
        token.approve(address(market), TICKET_COST * 3);
        vm.expectRevert(EncryptedMarket.MarketFull.selector);
        market.submitCommitment(marketId, commitment3);
        vm.stopPrank();
    }

    function test_RevertWhen_AlreadyCommitted() public {
        uint256 marketId = _createMarket();

        bytes32 commitment = keccak256("test");

        vm.startPrank(agentA);
        token.approve(address(market), TICKET_COST * 2);
        market.submitCommitment(marketId, commitment);

        vm.expectRevert(EncryptedMarket.AlreadyCommitted.selector);
        market.submitCommitment(marketId, commitment);
        vm.stopPrank();
    }

    function test_RevealInfoPhase() public {
        uint256 marketId = _setupInfoPhase();

        vm.warp(block.timestamp + INFO_DURATION + 1);

        bytes32 merkleRoot = keccak256("merkle");
        Outcome consensus = Outcome.YES;
        uint128 reserveYes = 80 * 1e18;
        uint128 reserveNo = 20 * 1e18;

        vm.prank(creForwarder);
        market.revealInfoPhase(marketId, merkleRoot, consensus, reserveYes, reserveNo);

        MarketState memory state = market.states(marketId);
        assertEq(state.merkleRoot, merkleRoot);
        assertEq(uint256(state.consensusOutcome), uint256(consensus));
        assertEq(state.reserveYes, reserveYes);
        assertEq(state.reserveNo, reserveNo);
        assertEq(uint256(state.phase), uint256(MarketPhase.TRADING));
    }

    function test_RevertWhen_RevealNotFromForwarder() public {
        uint256 marketId = _setupInfoPhase();

        vm.warp(block.timestamp + INFO_DURATION + 1);

        vm.expectRevert(EncryptedMarket.UnauthorizedForwarder.selector);
        market.revealInfoPhase(marketId, keccak256("root"), Outcome.YES, 100, 100);
    }

    function test_ClaimShares() public {
        uint256 marketId = _setupRevealedMarket();

        bytes32 leaf = MerkleVerifier.hashLeaf(agentA, uint8(Outcome.YES), 40 * 1e18);
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(agentA);
        market.claimShares(marketId, MerkleProof({
            root: states[marketId].merkleRoot,
            proof: proof,
            index: 0,
            agent: agentA,
            predictedOutcome: Outcome.YES,
            allocatedShares: 40 * 1e18
        }));

        AgentState memory state = market.agentStates(marketId, agentA);
        assertEq(state.yesShares, 40 * 1e18);
        assertTrue(state.claimedInitialShares);
    }

    function test_SwapShares() public {
        uint256 marketId = _setupTradingMarket();

        uint256 burnAmount = 10 * 1e18;
        uint256 expectedMint = market.calculateSwapOutput(marketId, Outcome.YES, burnAmount);

        vm.prank(agentA);
        market.swapShares(marketId, Outcome.YES, burnAmount);

        AgentState memory state = market.agentStates(marketId, agentA);
        assertEq(state.yesShares, 30 * 1e18 - burnAmount);
        assertEq(state.noShares, expectedMint);
    }

    function test_SwapSharesSkewsPrice() public {
        uint256 marketId = _setupTradingMarket();

        MarketState memory beforeState = market.states(marketId);
        (uint256 priceYesBefore, uint256 priceNoBefore) = market.getPriceRatio(marketId);

        vm.startPrank(agentA);
        for (uint256 i = 0; i < 5; i++) {
            market.swapShares(marketId, Outcome.YES, 5 * 1e18);
        }
        vm.stopPrank();

        (uint256 priceYesAfter, uint256 priceNoAfter) = market.getPriceRatio(marketId);

        assertLt(priceYesAfter, priceYesBefore, "YES price should decrease");
        assertGt(priceNoAfter, priceNoBefore, "NO price should increase");
    }

    function test_ResolveMarket() public {
        uint256 marketId = _setupTradingMarket();

        vm.warp(block.timestamp + TRADING_DURATION + 1);

        vm.prank(creForwarder);
        market.resolveMarket(marketId, Outcome.YES);

        MarketState memory state = market.states(marketId);
        assertEq(uint256(state.resolvedOutcome), uint256(Outcome.YES));
        assertEq(uint256(state.phase), uint256(MarketPhase.RESOLVED));
    }

    function test_ClaimPayout() public {
        uint256 marketId = _setupResolvedMarket(Outcome.YES);

        uint256 balanceBefore = token.balanceOf(agentA);

        vm.prank(agentA);
        market.claimPayout(marketId);

        uint256 balanceAfter = token.balanceOf(agentA);
        assertGt(balanceAfter, balanceBefore);
    }

    function test_CalculateSwapOutput() public view {
        uint256 reserveYes = 900 * 1e18;
        uint256 reserveNo = 100 * 1e18;
        uint256 burnAmount = 10 * 1e18;

        uint256 mintAmount = ConstantSum.calculateSwapOutput(reserveYes, reserveNo, burnAmount);

        assertGt(mintAmount, 0);
        assertLt(mintAmount, burnAmount * 10);
    }

    function test_QuadraticAllocation() public pure {
        uint256 baseShares = 10 * 1e18;

        uint256 consensusShares = Quadratic.calculateShareAllocation(baseShares, true);
        uint256 nonConsensusShares = Quadratic.calculateShareAllocation(baseShares, false);

        assertEq(consensusShares, baseShares * 4);
        assertEq(nonConsensusShares, baseShares);
    }

    function test_RevertWhen_SwapNotInfoParticipant() public {
        uint256 marketId = _setupRevealedMarket();

        vm.prank(unauthorized);
        vm.expectRevert(EncryptedMarket.NotInfoParticipant.selector);
        market.swapShares(marketId, Outcome.YES, 10 * 1e18);
    }

    function test_RevertWhen_SwapInsufficientShares() public {
        uint256 marketId = _setupTradingMarket();

        vm.startPrank(agentA);
        vm.expectRevert(EncryptedMarket.InsufficientShares.selector);
        market.swapShares(marketId, Outcome.YES, 1000 * 1e18);
        vm.stopPrank();
    }

    function testFuzz_CreateMarket(
        string calldata question,
        uint256 maxSlots,
        uint256 ticketCost,
        uint48 infoDuration,
        uint48 tradingDuration
    ) public {
        vm.assume(bytes(question).length > 0 && bytes(question).length < 1000);
        vm.assume(maxSlots > 0 && maxSlots <= 10000);
        vm.assume(ticketCost > 0 && ticketCost <= 1e24);
        vm.assume(infoDuration > 0 && infoDuration <= 30 days);
        vm.assume(tradingDuration > 0 && tradingDuration <= 365 days);

        vm.startPrank(owner);
        token.approve(address(market), ticketCost * maxSlots);

        uint256 marketId = market.createMarket(
            question,
            address(token),
            maxSlots,
            ticketCost,
            infoDuration,
            tradingDuration
        );

        MarketConfig memory config = market.configs(marketId);
        assertEq(config.question, question);
        assertEq(config.maxSlots, maxSlots);
        assertEq(config.ticketCost, ticketCost);

        vm.stopPrank();
    }

    function testFuzz_QuadraticAllocation(uint256 baseShares, bool isConsensus) public pure {
        vm.assume(baseShares > 0 && baseShares <= 1e24);

        uint256 allocation = Quadratic.calculateShareAllocation(baseShares, isConsensus);

        uint256 multiplier = isConsensus ? 4 : 1;
        assertEq(allocation, baseShares * multiplier);
        assertGe(allocation, baseShares);
        assertLe(allocation, baseShares * 4);
    }

    function testFuzz_MerkleVerifier(
        address agent,
        uint8 outcome,
        uint256 shares,
        bytes32[] calldata proof
    ) public pure {
        vm.assume(outcome == 1 || outcome == 2);
        vm.assume(shares > 0);

        bytes32 leaf = MerkleVerifier.hashLeaf(agent, outcome, shares);

        bytes32 root = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            root = keccak256(abi.encodePacked(root, proof[i]));
        }

        bool valid = MerkleVerifier.verify(proof, root, leaf, 0);
        assertTrue(valid);
    }

    function _createMarket() internal returns (uint256) {
        vm.startPrank(owner);
        token.approve(address(market), TICKET_COST * MAX_SLOTS);
        uint256 marketId = market.createMarket(
            "Test market",
            address(token),
            MAX_SLOTS,
            TICKET_COST,
            INFO_DURATION,
            TRADING_DURATION
        );
        vm.stopPrank();
        return marketId;
    }

    function _createMarketWithSmallSlots(uint256 slots) internal returns (uint256) {
        vm.startPrank(owner);
        token.approve(address(market), TICKET_COST * slots);
        uint256 marketId = market.createMarket(
            "Small market",
            address(token),
            slots,
            TICKET_COST,
            INFO_DURATION,
            TRADING_DURATION
        );
        vm.stopPrank();
        return marketId;
    }

    function _setupInfoPhase() internal returns (uint256) {
        uint256 marketId = _createMarket();

        vm.startPrank(agentA);
        token.approve(address(market), TICKET_COST);
        market.submitCommitment(marketId, keccak256("a"));
        vm.stopPrank();

        vm.startPrank(agentB);
        token.approve(address(market), TICKET_COST);
        market.submitCommitment(marketId, keccak256("b"));
        vm.stopPrank();

        return marketId;
    }

    function _setupRevealedMarket() internal returns (uint256) {
        uint256 marketId = _setupInfoPhase();

        vm.warp(block.timestamp + INFO_DURATION + 1);

        bytes32 merkleRoot = keccak256("merkle");
        
        vm.prank(creForwarder);
        market.revealInfoPhase(
            marketId,
            merkleRoot,
            Outcome.YES,
            80 * 1e18,
            20 * 1e18
        );

        return marketId;
    }

    function _setupTradingMarket() internal returns (uint256) {
        uint256 marketId = _setupRevealedMarket();

        bytes32 leaf = MerkleVerifier.hashLeaf(agentA, uint8(Outcome.YES), 40 * 1e18);
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(agentA);
        market.claimShares(marketId, MerkleProof({
            root: states[marketId].merkleRoot,
            proof: proof,
            index: 0,
            agent: agentA,
            predictedOutcome: Outcome.YES,
            allocatedShares: 40 * 1e18
        }));

        return marketId;
    }

    function _setupResolvedMarket(Outcome winningOutcome) internal returns (uint256) {
        uint256 marketId = _setupTradingMarket();

        vm.warp(block.timestamp + TRADING_DURATION + 1);

        vm.prank(creForwarder);
        market.resolveMarket(marketId, winningOutcome);

        return marketId;
    }
}
