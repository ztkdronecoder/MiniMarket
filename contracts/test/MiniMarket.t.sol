// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {MiniMarket} from "../src/MiniMarket.sol";
import {IMarket, MarketPhase, Outcome, MerkleProof, EncryptedSubmission, MarketConfig} from "../src/interfaces/IMarket.sol";
import {ConstantSum} from "../src/libraries/ConstantSum.sol";
import {Quadratic} from "../src/libraries/Quadratic.sol";
import {MerkleVerifier} from "../src/libraries/MerkleVerifier.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {
        _mint(msg.sender, 10_000_000 * 10 ** decimals());
    }
}

contract MiniMarketTest is Test {
    MiniMarket public market;
    MockERC20 public token;

    address public owner = address(0x1);
    address public creForwarder = address(0x2);
    address public agentA = address(0x10);
    address public agentB = address(0x11);
    address public agentC = address(0x12);
    address public unauthorized = address(0x99);

    uint256 public constant TICKET_COST = 10 * 1e18;
    uint256 public constant MAX_SLOTS = 100;
    uint48 public constant TRADING_DURATION = 24 hours;

    uint64 public currentDrandRound;
    uint64 public targetDrandRound;

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

    function setUp() public {
        vm.startPrank(owner);
        market = new MiniMarket(creForwarder, owner);
        token = new MockERC20();
        vm.stopPrank();

        vm.deal(owner, 1000 ether);
        vm.deal(agentA, 100 ether);
        vm.deal(agentB, 100 ether);
        vm.deal(agentC, 100 ether);

        vm.warp(1700000000);

        currentDrandRound = uint64((block.timestamp - market.DRAND_GENESIS()) / market.DRAND_PERIOD());
        targetDrandRound = currentDrandRound + 1200;

        // Transfer tokens to agents for testing
        vm.startPrank(owner);
        token.transfer(agentA, 10000 * TICKET_COST);
        token.transfer(agentB, 10000 * TICKET_COST);
        token.transfer(agentC, 10000 * TICKET_COST);
        vm.stopPrank();

        currentDrandRound = uint64((block.timestamp - market.DRAND_GENESIS()) / market.DRAND_PERIOD());
        targetDrandRound = currentDrandRound + 1200;
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
            targetDrandRound
        );

        uint256 marketId = market.createMarket(
            "Will ETH > $4000 by Mar 1?",
            address(token),
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound,
            market.DRAND_QUICKNET_HASH(),
            TRADING_DURATION
        );

        assertEq(marketId, 1);

        (
            uint256 configMarketId,
            string memory configQuestion,
            address configPaymentToken,
            uint256 configMaxSlots,
            uint256 configTicketCost,
            uint256 configMarketCap,
            uint64 configDrandTargetRound,
            ,
            ,
            
        ) = market.configs(marketId);

        assertEq(configMarketId, 1);
        assertEq(configQuestion, "Will ETH > $4000 by Mar 1?");
        assertEq(configPaymentToken, address(token));
        assertEq(configMaxSlots, MAX_SLOTS);
        assertEq(configTicketCost, TICKET_COST);
        assertEq(configMarketCap, MAX_SLOTS * TICKET_COST);
        assertEq(configDrandTargetRound, targetDrandRound);

        (MarketPhase statePhase, , , , , , , ) = market.states(marketId);
        assertEq(uint256(statePhase), uint256(MarketPhase.INFO_COLLECTION));

        vm.stopPrank();
    }

    function test_CreateMarketETH() public {
        vm.startPrank(owner);

        uint256 marketId = market.createMarket{value: TICKET_COST * MAX_SLOTS}(
            "ETH market",
            address(0),
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound,
            market.DRAND_QUICKNET_HASH(),
            TRADING_DURATION
        );

        (
            ,
            ,
            address configPaymentToken,
            ,
            ,
            uint256 configMarketCap,
            ,
            ,
            ,

        ) = market.configs(marketId);
        assertEq(configPaymentToken, address(0));
        assertEq(configMarketCap, TICKET_COST * MAX_SLOTS);

        vm.stopPrank();
    }

    function test_SubmitEncrypted() public {
        uint256 marketId = _createMarket();

        bytes memory ciphertext = abi.encodePacked("encrypted_payload");
        bytes32 validationHash = keccak256(abi.encodePacked(uint8(1), agentA, bytes32("salt")));

        vm.startPrank(agentA);
        token.approve(address(market), TICKET_COST);

        market.submitEncrypted(marketId, ciphertext, validationHash);

        assertEq(market.getSubmissionCount(marketId), 1);

        assertTrue(market.hasSubmitted(marketId, agentA));

        (, , bool participatedInInfo, ) = market.agentStates(marketId, agentA);
        assertTrue(participatedInInfo);

        vm.stopPrank();
    }

    function test_SubmitEncryptedETH() public {
        vm.startPrank(owner);
        uint256 marketId = market.createMarket{value: TICKET_COST * MAX_SLOTS}(
            "ETH market",
            address(0),
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound,
            market.DRAND_QUICKNET_HASH(),
            TRADING_DURATION
        );
        vm.stopPrank();

        bytes memory ciphertext = abi.encodePacked("encrypted_payload");
        bytes32 validationHash = keccak256(abi.encodePacked(uint8(1), agentA, bytes32("salt")));

        vm.startPrank(agentA);
        market.submitEncrypted{value: TICKET_COST}(marketId, ciphertext, validationHash);

        assertEq(market.getSubmissionCount(marketId), 1);
        vm.stopPrank();
    }

    function test_RevertWhen_MarketFull() public {
        uint256 marketId = _createMarketWithSmallSlots(2);

        bytes memory ciphertext = abi.encodePacked("encrypted");
        bytes32 validationHash = keccak256("test");

        vm.startPrank(agentA);
        token.approve(address(market), TICKET_COST * 3);
        market.submitEncrypted(marketId, ciphertext, validationHash);
        vm.stopPrank();

        vm.startPrank(agentB);
        token.approve(address(market), TICKET_COST * 3);
        market.submitEncrypted(marketId, ciphertext, validationHash);
        vm.stopPrank();

        vm.startPrank(agentC);
        token.approve(address(market), TICKET_COST * 3);
        vm.expectRevert(MiniMarket.MarketFull.selector);
        market.submitEncrypted(marketId, ciphertext, validationHash);
        vm.stopPrank();
    }

    function test_RevertWhen_AlreadySubmitted() public {
        uint256 marketId = _createMarket();

        bytes memory ciphertext = abi.encodePacked("encrypted");
        bytes32 validationHash = keccak256("test");

        vm.startPrank(agentA);
        token.approve(address(market), TICKET_COST * 2);
        market.submitEncrypted(marketId, ciphertext, validationHash);

        vm.expectRevert(MiniMarket.AlreadySubmitted.selector);
        market.submitEncrypted(marketId, ciphertext, validationHash);
        vm.stopPrank();
    }

    function test_RevealInfoPhase() public {
        uint256 marketId = _setupInfoPhase();

        vm.warp(block.timestamp + 1 hours + 1);

        bytes32 merkleRoot = keccak256("merkle");
        Outcome consensus = Outcome.YES;
        uint128 reserveYes = 80 * 1e18;
        uint128 reserveNo = 20 * 1e18;

        vm.prank(creForwarder);
        market.revealInfoPhase(marketId, merkleRoot, consensus, reserveYes, reserveNo, 2);

        (
            MarketPhase phase,
            bytes32 stateMerkleRoot,
            Outcome stateConsensus,
            uint128 stateReserveYes,
            uint128 stateReserveNo,
            ,
            ,

        ) = market.states(marketId);

        assertEq(stateMerkleRoot, merkleRoot);
        assertEq(uint256(stateConsensus), uint256(consensus));
        assertEq(stateReserveYes, reserveYes);
        assertEq(stateReserveNo, reserveNo);
        assertEq(uint256(phase), uint256(MarketPhase.TRADING));
    }

    function test_RevertWhen_RevealNotFromForwarder() public {
        uint256 marketId = _setupInfoPhase();

        vm.warp(block.timestamp + 1 hours + 1);

        vm.expectRevert(MiniMarket.UnauthorizedForwarder.selector);
        market.revealInfoPhase(marketId, keccak256("root"), Outcome.YES, 100, 100, 1);
    }

    function test_ClaimShares() public {
        uint256 marketId = _setupRevealedMarket();

        (, bytes32 stateMerkleRoot, , , , , , ) = market.states(marketId);

        bytes32 leaf = MerkleVerifier.hashLeaf(agentA, uint8(Outcome.YES), 40 * 1e18);
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(agentA);
        market.claimShares(marketId, MerkleProof({
            root: stateMerkleRoot,
            proof: proof,
            index: 0,
            agent: agentA,
            predictedOutcome: Outcome.YES,
            allocatedShares: 40 * 1e18
        }));

        (uint128 yesShares, , , ) = market.agentStates(marketId, agentA);
        assertEq(yesShares, 40 * 1e18);
    }

    function test_SwapShares() public {
        uint256 marketId = _setupTradingMarket();

        uint256 burnAmount = 10 * 1e18;
        uint256 expectedMint = market.calculateSwapOutput(marketId, Outcome.YES, burnAmount);

        vm.prank(agentA);
        market.swapShares(marketId, Outcome.YES, burnAmount);

        (uint128 yesShares, uint128 noShares, , ) = market.agentStates(marketId, agentA);
        assertEq(yesShares, 40 * 1e18 - burnAmount);
        assertEq(noShares, expectedMint);
    }

    function test_SwapSharesSkewsPrice() public {
        uint256 marketId = _setupTradingMarket();

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

        (MarketPhase phase, , , , , , , Outcome resolvedOutcome) = market.states(marketId);
        assertEq(uint256(resolvedOutcome), uint256(Outcome.YES));
        assertEq(uint256(phase), uint256(MarketPhase.RESOLVED));
    }

    function test_ClaimPayout() public {
        uint256 marketId = _setupResolvedMarket(Outcome.YES);

        uint256 balanceBefore = token.balanceOf(agentA);

        vm.prank(agentA);
        market.claimPayout(marketId);

        uint256 balanceAfter = token.balanceOf(agentA);
        assertGt(balanceAfter, balanceBefore);
    }

    function test_CalculateSwapOutput() public pure {
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
        vm.expectRevert(MiniMarket.NotInfoParticipant.selector);
        market.swapShares(marketId, Outcome.YES, 10 * 1e18);
    }

    function test_RevertWhen_SwapInsufficientShares() public {
        uint256 marketId = _setupTradingMarket();

        vm.startPrank(agentA);
        vm.expectRevert(MiniMarket.InsufficientShares.selector);
        market.swapShares(marketId, Outcome.YES, 1000 * 1e18);
        vm.stopPrank();
    }

    function test_ValidationHashMatching() public {
        uint256 marketId = _createMarket();

        uint8 outcome = 1;
        bytes32 salt = bytes32("random_salt");
        bytes32 validationHash = keccak256(abi.encodePacked(outcome, agentA, salt));

        bytes memory ciphertext = abi.encodePacked("encrypted_payload");

        vm.startPrank(agentA);
        token.approve(address(market), TICKET_COST);
        market.submitEncrypted(marketId, ciphertext, validationHash);

        bytes32 computedHash = keccak256(abi.encodePacked(outcome, agentA, salt));
        assertEq(computedHash, validationHash, "Validation hash should match");

        vm.stopPrank();
    }

    function testFuzz_CreateMarket(
        string calldata question,
        uint256 maxSlots,
        uint256 ticketCost,
        uint64 roundOffset,
        uint48 tradingDuration
    ) public {
        vm.assume(bytes(question).length > 0 && bytes(question).length < 1000);
        vm.assume(maxSlots > 0 && maxSlots <= 100);
        vm.assume(ticketCost > 0 && ticketCost <= 1000 * 1e18);
        vm.assume(roundOffset >= 100 && roundOffset <= 1000000);
        vm.assume(tradingDuration > 0 && tradingDuration <= 365 days);

        uint64 localTargetRound = currentDrandRound + roundOffset;

        vm.startPrank(owner);
        token.approve(address(market), ticketCost * maxSlots);

        uint256 marketId = market.createMarket(
            question,
            address(token),
            maxSlots,
            ticketCost,
            localTargetRound,
            market.DRAND_QUICKNET_HASH(),
            tradingDuration
        );

        (
            uint256 configMarketId,
            string memory configQuestion,
            ,
            uint256 configMaxSlots,
            uint256 configTicketCost,
            ,
            uint64 configDrandTargetRound,
            ,
            ,

        ) = market.configs(marketId);

        assertEq(configMarketId, marketId);
        assertEq(configQuestion, question);
        assertEq(configMaxSlots, maxSlots);
        assertEq(configTicketCost, ticketCost);
        assertEq(configDrandTargetRound, localTargetRound);

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
            targetDrandRound,
            market.DRAND_QUICKNET_HASH(),
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
            targetDrandRound,
            market.DRAND_QUICKNET_HASH(),
            uint48(TRADING_DURATION)
        );
        vm.stopPrank();
        return marketId;
    }

    function _setupInfoPhase() internal returns (uint256) {
        uint256 marketId = _createMarket();

        bytes memory ciphertext = abi.encodePacked("encrypted");
        bytes32 validationHash = keccak256("test");

        vm.startPrank(agentA);
        token.approve(address(market), TICKET_COST);
        market.submitEncrypted(marketId, ciphertext, validationHash);
        vm.stopPrank();

        vm.startPrank(agentB);
        token.approve(address(market), TICKET_COST);
        market.submitEncrypted(marketId, ciphertext, validationHash);
        vm.stopPrank();

        return marketId;
    }

    function _setupRevealedMarket() internal returns (uint256) {
        uint256 marketId = _setupInfoPhase();

        vm.warp(block.timestamp + 1 hours + 1);

        // Properly compute merkle root - single leaf case
        bytes32 leaf = MerkleVerifier.hashLeaf(agentA, uint8(Outcome.YES), 40 * 1e18);
        bytes32 merkleRoot = leaf;

        vm.prank(creForwarder);
        market.revealInfoPhase(
            marketId,
            merkleRoot,
            Outcome.YES,
            80 * 1e18,
            20 * 1e18,
            2
        );

        return marketId;
    }

    function _setupTradingMarket() internal returns (uint256) {
        uint256 marketId = _setupRevealedMarket();

        (, bytes32 stateMerkleRoot, , , , , , ) = market.states(marketId);

        bytes32 leaf = MerkleVerifier.hashLeaf(agentA, uint8(Outcome.YES), 40 * 1e18);
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(agentA);
        market.claimShares(marketId, MerkleProof({
            root: stateMerkleRoot,
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

contract MiniMarketAutomationTest is Test {
    MiniMarket public market;
    MockERC20 public token;

    address public owner = address(0x1);
    address public creForwarder = address(0x2);
    address public agentA = address(0x10);
    address public agentB = address(0x11);

    uint256 public constant TICKET_COST = 10 * 1e18;
    uint256 public constant MAX_SLOTS = 100;
    uint48 public constant TRADING_DURATION = 24 hours;

    uint64 public currentDrandRound;
    uint64 public targetDrandRound;

    function setUp() public {
        vm.startPrank(owner);
        market = new MiniMarket(creForwarder, owner);
        token = new MockERC20();
        vm.stopPrank();

        vm.deal(owner, 1000 ether);
        vm.deal(agentA, 100 ether);
        vm.deal(agentB, 100 ether);

        vm.warp(1700000000);

        currentDrandRound = uint64((block.timestamp - market.DRAND_GENESIS()) / market.DRAND_PERIOD());
        targetDrandRound = currentDrandRound + 1200;

        vm.startPrank(owner);
        token.transfer(agentA, 10000 * TICKET_COST);
        token.transfer(agentB, 10000 * TICKET_COST);
        vm.stopPrank();
    }

    function test_RequestInfoReveal() public {
        uint256 marketId = _createMarketWithSubmissions();

        vm.warp(block.timestamp + 1 hours + 1);

        vm.expectEmit(true, false, false, true);
        emit IMarket.InfoRevealRequested(marketId, targetDrandRound, 2);

        market.requestInfoReveal(marketId);

        assertTrue(market.infoRevealRequested(marketId));
    }

    function test_RequestInfoReveal_RevertIf_RoundNotReached() public {
        uint256 marketId = _createMarketWithSubmissions();

        vm.expectRevert("Round not reached");
        market.requestInfoReveal(marketId);
    }

    function test_RequestInfoReveal_RevertIf_AlreadyRequested() public {
        uint256 marketId = _createMarketWithSubmissions();

        vm.warp(block.timestamp + 1 hours + 1);
        market.requestInfoReveal(marketId);

        vm.expectRevert("Already requested");
        market.requestInfoReveal(marketId);
    }

    function test_RequestResolution() public {
        uint256 marketId = _setupRevealedMarket();

        vm.warp(block.timestamp + TRADING_DURATION + 1);

        MarketConfig memory config;
        (, , , , , , , , config.tradingDuration, config.createdAt) = market.configs(marketId);
        uint48 tradingEnd = config.createdAt + config.tradingDuration;

        vm.expectEmit(true, false, false, true);
        emit IMarket.ResolutionRequested(marketId, tradingEnd);

        market.requestResolution(marketId);

        assertTrue(market.resolutionRequested(marketId));
    }

    function test_RequestResolution_RevertIf_TradingNotEnded() public {
        uint256 marketId = _setupRevealedMarket();

        vm.expectRevert("Trading not ended");
        market.requestResolution(marketId);
    }

    function test_CheckUpkeep_InfoRevealNeeded() public {
        uint256 marketId = _createMarketWithSubmissions();

        vm.warp(block.timestamp + 1 hours + 1);

        (bool upkeepNeeded, bytes memory performData) = market.checkUpkeep("");

        assertTrue(upkeepNeeded);

        (uint8 action, uint256 checkMarketId) = abi.decode(performData, (uint8, uint256));
        assertEq(action, 0);
        assertEq(checkMarketId, marketId);
    }

    function test_CheckUpkeep_ResolutionNeeded() public {
        uint256 marketId = _setupRevealedMarket();

        vm.warp(block.timestamp + TRADING_DURATION + 1);

        (bool upkeepNeeded, bytes memory performData) = market.checkUpkeep("");

        assertTrue(upkeepNeeded);

        (uint8 action, uint256 checkMarketId) = abi.decode(performData, (uint8, uint256));
        assertEq(action, 1);
        assertEq(checkMarketId, marketId);
    }

    function test_CheckUpkeep_NoUpkeepNeeded() public {
        _createMarketWithSubmissions();

        (bool upkeepNeeded, ) = market.checkUpkeep("");

        assertFalse(upkeepNeeded);
    }

    function test_PerformUpkeep_InfoReveal() public {
        uint256 marketId = _createMarketWithSubmissions();

        vm.warp(block.timestamp + 1 hours + 1);

        bytes memory performData = abi.encode(uint8(0), marketId);

        market.performUpkeep(performData);

        assertTrue(market.infoRevealRequested(marketId));
    }

    function test_PerformUpkeep_Resolution() public {
        uint256 marketId = _setupRevealedMarket();

        vm.warp(block.timestamp + TRADING_DURATION + 1);

        bytes memory performData = abi.encode(uint8(1), marketId);

        market.performUpkeep(performData);

        assertTrue(market.resolutionRequested(marketId));
    }

    function _createMarketWithSubmissions() internal returns (uint256) {
        vm.startPrank(owner);
        token.approve(address(market), TICKET_COST * MAX_SLOTS);
        uint256 marketId = market.createMarket(
            "Test market",
            address(token),
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound,
            market.DRAND_QUICKNET_HASH(),
            TRADING_DURATION
        );
        vm.stopPrank();

        bytes memory ciphertext = abi.encodePacked("encrypted");

        vm.startPrank(agentA);
        token.approve(address(market), TICKET_COST);
        market.submitEncrypted(marketId, ciphertext, keccak256("test"));
        vm.stopPrank();

        vm.startPrank(agentB);
        token.approve(address(market), TICKET_COST);
        market.submitEncrypted(marketId, ciphertext, keccak256("test2"));
        vm.stopPrank();

        return marketId;
    }

    function _setupRevealedMarket() internal returns (uint256) {
        uint256 marketId = _createMarketWithSubmissions();

        vm.warp(block.timestamp + 1 hours + 1);

        bytes32 leaf = MerkleVerifier.hashLeaf(agentA, uint8(Outcome.YES), 40 * 1e18);
        bytes32 merkleRoot = leaf;

        vm.prank(creForwarder);
        market.revealInfoPhase(
            marketId,
            merkleRoot,
            Outcome.YES,
            80 * 1e18,
            20 * 1e18,
            2
        );

        return marketId;
    }
}

contract MiniMarketForkTest is Test {
    string constant BASE_SEPOLIA_RPC = "https://sepolia.base.org";

    MiniMarket public market;
    address public constant LINK_TOKEN = 0x71052BAe71C25C78E37fD12E5ff1101A71d9018F;
    address public constant AUTOMATION_REGISTRY = 0x91D4a4C3D448c7f3CB477332B1c7D420a5810aC3;

    address public owner = address(0x1);
    address public creForwarder = address(0x2);

    function setUp() public {
        vm.createSelectFork(BASE_SEPOLIA_RPC);
        vm.deal(owner, 100 ether);
        vm.startPrank(owner);
        market = new MiniMarket(creForwarder, owner);
        vm.stopPrank();
    }

    function test_Fork_Deployment() public view {
        assertEq(market.CRE_FORWARDER(), creForwarder);
        assertEq(market.DRAND_QUICKNET_HASH(), 0xdbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3ccac746459b582);
        assertEq(market.DRAND_GENESIS(), 1692803367);
        assertEq(market.DRAND_PERIOD(), 3);
    }

    function test_Fork_CreateMarketETH() public {
        vm.startPrank(owner);

        uint64 currentRound = uint64((block.timestamp - market.DRAND_GENESIS()) / market.DRAND_PERIOD());
        uint64 targetRound = currentRound + 1200;

        uint256 marketId = market.createMarket{value: 10 * 1e18}(
            "Fork test market",
            address(0),
            1,
            10 * 1e18,
            targetRound,
            market.DRAND_QUICKNET_HASH(),
            uint48(1 hours)
        );

        assertEq(marketId, 1);
        vm.stopPrank();
    }

    function test_Fork_AutomationRegistryExists() public view {
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(AUTOMATION_REGISTRY)
        }
        assertGt(codeSize, 0, "Automation registry should exist");
    }
}
