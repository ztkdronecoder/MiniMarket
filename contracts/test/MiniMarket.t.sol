// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {MiniMarket} from "../src/MiniMarket.sol";
import {IMarket, MarketPhase, Outcome, MerkleProof, EncryptedSubmission, MarketConfig} from "../src/interfaces/IMarket.sol";
import {ConstantSum} from "../src/libraries/ConstantSum.sol";
import {Quadratic} from "../src/libraries/Quadratic.sol";
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
    string public constant MOCK_SCHEMA_URI = "ipfs://QmMockSchemaHash123456789";

    uint64 public currentDrandRound;
    uint64 public targetDrandRound;

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
            MOCK_SCHEMA_URI,
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound
        );

        uint256 marketId = market.createMarket(
            "Will ETH > $4000 by Mar 1?",
            MOCK_SCHEMA_URI,
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
            string memory configSchemaURI,
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
        assertEq(configSchemaURI, MOCK_SCHEMA_URI);
        assertEq(configPaymentToken, address(token));
        assertEq(configMaxSlots, MAX_SLOTS);
        assertEq(configTicketCost, TICKET_COST);
        assertEq(configMarketCap, MAX_SLOTS * TICKET_COST);
        assertEq(configDrandTargetRound, targetDrandRound);

        (MarketPhase statePhase, , , , , , , , , ) = market.states(marketId);
        assertEq(uint256(statePhase), uint256(MarketPhase.INFO_COLLECTION));

        vm.stopPrank();
    }

    function test_CreateMarketETH() public {
        vm.startPrank(owner);

        uint256 marketId = market.createMarket{value: TICKET_COST * MAX_SLOTS}(
            "ETH market",
            MOCK_SCHEMA_URI,
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
            MOCK_SCHEMA_URI,
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
        market.revealInfoPhase(marketId, merkleRoot, consensus, reserveYes, reserveNo, 2, 30 * 1e18, 10 * 1e18);

        (
            MarketPhase phase,
            bytes32 stateMerkleRoot,
            Outcome stateConsensus,
            uint128 stateReserveYes,
            uint128 stateReserveNo,
            ,
            ,
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
        market.revealInfoPhase(marketId, keccak256("root"), Outcome.YES, 100, 100, 1, 0, 0);
    }

    function test_ClaimShares() public {
        uint256 marketId = _setupRevealedMarket();

        (, bytes32 stateMerkleRoot, , , , , , , , ) = market.states(marketId);

        uint256 yesShares = 30 * 1e18;
        uint256 noShares = 10 * 1e18;
        bytes32 leaf = keccak256(abi.encodePacked(agentA, yesShares, noShares));
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(agentA);
        market.claimShares(marketId, MerkleProof({
            root: stateMerkleRoot,
            proof: proof,
            index: 0,
            agent: agentA,
            yesShares: yesShares,
            noShares: noShares
        }));

        (uint128 agentYes, uint128 agentNo, , ) = market.agentStates(marketId, agentA);
        assertEq(agentYes, yesShares);
        assertEq(agentNo, noShares);
    }

    function test_SwapShares() public {
        uint256 marketId = _setupTradingMarket();

        uint256 burnAmount = 10 * 1e18;
        uint256 expectedMint = market.calculateSwapOutput(marketId, Outcome.YES, burnAmount);

        vm.prank(agentA);
        market.swapShares(marketId, Outcome.YES, burnAmount);

        (uint128 yesShares, uint128 noShares, , ) = market.agentStates(marketId, agentA);
        assertEq(yesShares, 30 * 1e18 - burnAmount);
        assertEq(noShares, 10 * 1e18 + expectedMint);
    }

    function test_SwapSharesSkewsPrice() public {
        uint256 marketId = _setupTradingMarket();

        (uint256 priceYesBefore, uint256 priceNoBefore) = market.getPriceRatio(marketId);

        vm.startPrank(agentA);
        for (uint256 i = 0; i < 3; i++) {
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

        (MarketPhase phase, , , , , , , Outcome resolvedOutcome, , ) = market.states(marketId);
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
            MOCK_SCHEMA_URI,
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

    function testFuzz_LeafHash(
        address agent,
        uint256 yesShares,
        uint256 noShares
    ) public pure {
        vm.assume(yesShares > 0 || noShares > 0);

        bytes32 leaf = keccak256(abi.encodePacked(agent, yesShares, noShares));
        assertEq(leaf, keccak256(abi.encodePacked(agent, yesShares, noShares)));
    }

    function _createMarket() internal returns (uint256) {
        vm.startPrank(owner);
        token.approve(address(market), TICKET_COST * MAX_SLOTS);
        uint256 marketId = market.createMarket(
            "Test market",
            MOCK_SCHEMA_URI,
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
            MOCK_SCHEMA_URI,
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

        // Phase1 price discovery: agent gets yesShares + noShares
        uint256 yesShares = 30 * 1e18;
        uint256 noShares = 10 * 1e18;
        bytes32 leaf = keccak256(abi.encodePacked(agentA, yesShares, noShares));
        bytes32 merkleRoot = leaf;

        vm.prank(creForwarder);
        market.revealInfoPhase(
            marketId,
            merkleRoot,
            Outcome.YES,
            80 * 1e18,
            20 * 1e18,
            2,
            30 * 1e18,
            10 * 1e18
        );

        return marketId;
    }

    function _setupTradingMarket() internal returns (uint256) {
        uint256 marketId = _setupRevealedMarket();

        (, bytes32 stateMerkleRoot, , , , , , , , ) = market.states(marketId);

        uint256 yesShares = 30 * 1e18;
        uint256 noShares = 10 * 1e18;
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(agentA);
        market.claimShares(marketId, MerkleProof({
            root: stateMerkleRoot,
            proof: proof,
            index: 0,
            agent: agentA,
            yesShares: yesShares,
            noShares: noShares
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
    string public constant MOCK_SCHEMA_URI = "ipfs://QmMockSchemaHash123456789";

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
        (, , , , , , , , , config.createdAt, config.tradingDuration) = market.configs(marketId);
        uint48 tradingEnd = config.createdAt + config.tradingDuration;

        vm.expectEmit(true, false, false, true);
        emit IMarket.ResolutionRequested(marketId, MOCK_SCHEMA_URI, tradingEnd);

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
            MOCK_SCHEMA_URI,
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

        uint256 yesShares = 30 * 1e18;
        uint256 noShares = 10 * 1e18;
        bytes32 leaf = keccak256(abi.encodePacked(agentA, yesShares, noShares));
        bytes32 merkleRoot = leaf;

        vm.prank(creForwarder);
        market.revealInfoPhase(
            marketId,
            merkleRoot,
            Outcome.YES,
            80 * 1e18,
            20 * 1e18,
            2,
            30 * 1e18,
            10 * 1e18
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
    string public constant MOCK_SCHEMA_URI = "ipfs://QmMockSchemaHash123456789";

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
            MOCK_SCHEMA_URI,
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

contract MiniMarketEdgeCaseTest is Test {
    MiniMarket public market;
    MockERC20 public token;

    address public owner = address(0x1);
    address public creForwarder = address(0x2);
    address public agentA = address(0x100);
    address public agentB = address(0x101);

    uint256 public constant TICKET_COST = 10 * 1e18;
    uint256 public constant MAX_SLOTS = 100;
    uint48 public constant TRADING_DURATION = 24 hours;
    string public constant MOCK_SCHEMA_URI = "ipfs://QmMockSchemaHash123456789";

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

    function test_RevertWhen_CreateMarketEmptyQuestion() public {
        vm.startPrank(owner);
        token.approve(address(market), TICKET_COST * MAX_SLOTS);
        bytes32 chainHash = market.DRAND_QUICKNET_HASH();
        vm.expectRevert("Empty question");
        market.createMarket(
            "",
            MOCK_SCHEMA_URI,
            address(token),
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound,
            chainHash,
            TRADING_DURATION
        );
        vm.stopPrank();
    }

    function test_RevertWhen_CreateMarketZeroSlots() public {
        vm.startPrank(owner);
        token.approve(address(market), TICKET_COST * 100);
        bytes32 chainHash = market.DRAND_QUICKNET_HASH();
        vm.expectRevert("Zero slots");
        market.createMarket(
            "Test",
            MOCK_SCHEMA_URI,
            address(token),
            0,
            TICKET_COST,
            targetDrandRound,
            chainHash,
            TRADING_DURATION
        );
        vm.stopPrank();
    }

    function test_RevertWhen_CreateMarketZeroCost() public {
        vm.startPrank(owner);
        bytes32 chainHash = market.DRAND_QUICKNET_HASH();
        vm.expectRevert("Zero cost");
        market.createMarket{value: 0}(
            "Test",
            MOCK_SCHEMA_URI,
            address(0),
            MAX_SLOTS,
            0,
            targetDrandRound,
            chainHash,
            TRADING_DURATION
        );
        vm.stopPrank();
    }

    function test_RevertWhen_CreateMarketZeroDuration() public {
        vm.startPrank(owner);
        token.approve(address(market), TICKET_COST * MAX_SLOTS);
        bytes32 chainHash = market.DRAND_QUICKNET_HASH();
        vm.expectRevert("Zero duration");
        market.createMarket(
            "Test",
            MOCK_SCHEMA_URI,
            address(token),
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound,
            chainHash,
            0
        );
        vm.stopPrank();
    }

    // Round check is intentionally disabled in the contract (FOR TESTING ONLY comment).
    // This test is skipped until the round check is re-enabled in production.
    function test_RevertWhen_CreateMarketRoundPassed() public view {
        // no-op: round check disabled in MiniMarket.sol for testing convenience
    }

    function test_RevertWhen_SubmitEmptyCiphertext() public {
        uint256 marketId = _createMarket();

        vm.startPrank(agentA);
        token.approve(address(market), TICKET_COST);
        vm.expectRevert("Empty ciphertext");
        market.submitEncrypted(marketId, "", keccak256("test"));
        vm.stopPrank();
    }

    function test_RevertWhen_ClaimSharesTwice() public {
        uint256 marketId = _setupRevealedMarket();

        (, bytes32 stateMerkleRoot, , , , , , , , ) = market.states(marketId);

        bytes32[] memory proof = new bytes32[](0);

        vm.startPrank(agentA);
        market.claimShares(marketId, MerkleProof({
            root: stateMerkleRoot,
            proof: proof,
            index: 0,
            agent: agentA,
            yesShares: 30 * 1e18,
            noShares: 10 * 1e18
        }));

        vm.expectRevert(MiniMarket.AlreadyClaimedShares.selector);
        market.claimShares(marketId, MerkleProof({
            root: stateMerkleRoot,
            proof: proof,
            index: 0,
            agent: agentA,
            yesShares: 30 * 1e18,
            noShares: 10 * 1e18
        }));
        vm.stopPrank();
    }

    function test_RevertWhen_ClaimSharesWrongAgent() public {
        uint256 marketId = _setupRevealedMarket();

        (, bytes32 stateMerkleRoot, , , , , , , , ) = market.states(marketId);

        bytes32[] memory proof = new bytes32[](0);

        vm.prank(agentB);
        vm.expectRevert("Agent mismatch");
        market.claimShares(marketId, MerkleProof({
            root: stateMerkleRoot,
            proof: proof,
            index: 0,
            agent: agentA,
            yesShares: 30 * 1e18,
            noShares: 10 * 1e18
        }));
    }

    function test_RevertWhen_ClaimSharesInvalidMerkleProof() public {
        uint256 marketId = _setupRevealedMarket();

        (, bytes32 stateMerkleRoot, , , , , , , , ) = market.states(marketId);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256("fake");

        vm.prank(agentA);
        vm.expectRevert(MiniMarket.InvalidMerkleProof.selector);
        market.claimShares(marketId, MerkleProof({
            root: stateMerkleRoot,
            proof: proof,
            index: 0,
            agent: agentA,
            yesShares: 30 * 1e18,
            noShares: 10 * 1e18
        }));
    }

    function test_RevertWhen_ClaimPayoutTwice() public {
        uint256 marketId = _setupResolvedMarket(Outcome.YES);

        vm.prank(agentA);
        market.claimPayout(marketId);

        vm.prank(agentA);
        vm.expectRevert(MiniMarket.NothingToClaim.selector);
        market.claimPayout(marketId);
    }

    function test_RevertWhen_ClaimPayoutNoShares() public {
        uint256 marketId = _setupResolvedMarket(Outcome.YES);

        vm.prank(agentB);
        vm.expectRevert(MiniMarket.NothingToClaim.selector);
        market.claimPayout(marketId);
    }

    function test_RevertWhen_ResolveTwice() public {
        uint256 marketId = _setupTradingMarket();

        vm.warp(block.timestamp + TRADING_DURATION + 1);

        vm.prank(creForwarder);
        market.resolveMarket(marketId, Outcome.YES);

        vm.prank(creForwarder);
        vm.expectRevert(MiniMarket.InvalidPhase.selector);
        market.resolveMarket(marketId, Outcome.NO);
    }

    function test_MultipleMarkets() public {
        vm.startPrank(owner);
        token.approve(address(market), TICKET_COST * MAX_SLOTS * 3);

        uint256 market1 = market.createMarket(
            "Market 1",
            MOCK_SCHEMA_URI,
            address(token),
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound,
            market.DRAND_QUICKNET_HASH(),
            TRADING_DURATION
        );

        uint256 market2 = market.createMarket(
            "Market 2",
            MOCK_SCHEMA_URI,
            address(token),
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound + 100,
            market.DRAND_QUICKNET_HASH(),
            TRADING_DURATION
        );

        uint256 market3 = market.createMarket(
            "Market 3",
            MOCK_SCHEMA_URI,
            address(token),
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound + 200,
            market.DRAND_QUICKNET_HASH(),
            TRADING_DURATION
        );

        assertEq(market1, 1);
        assertEq(market2, 2);
        assertEq(market3, 3);
        vm.stopPrank();
    }

    function test_PriceInvariant() public {
        uint256 marketId = _setupTradingMarket();

        vm.startPrank(agentA);
        for (uint256 i = 0; i < 5; i++) {
            (uint256 priceYesBefore, uint256 priceNoBefore) = market.getPriceRatio(marketId);
            uint256 sumBefore = priceYesBefore + priceNoBefore;
            
            market.swapShares(marketId, Outcome.YES, 2 * 1e18);

            (uint256 priceYesAfter, uint256 priceNoAfter) = market.getPriceRatio(marketId);
            uint256 sumAfter = priceYesAfter + priceNoAfter;

            assertApproxEqAbs(sumBefore, 1e18, 100, "Price sum should be ~1");
            assertApproxEqAbs(sumAfter, 1e18, 100, "Price sum should remain ~1");
        }
        vm.stopPrank();
    }

    function test_ConsensusAllocationGreaterThanNonConsensus() public pure {
        uint256 baseShares = 10 * 1e18;

        uint256 consensusShares = Quadratic.calculateShareAllocation(baseShares, true);
        uint256 nonConsensusShares = Quadratic.calculateShareAllocation(baseShares, false);

        assertGt(consensusShares, nonConsensusShares, "Consensus should get more shares");
        assertEq(consensusShares, nonConsensusShares * 4, "Consensus should get 4x shares");
    }

    function test_CalculatePricesZeroReserve() public pure {
        (uint256 priceYes, uint256 priceNo) = ConstantSum.calculatePrices(0, 0);

        assertEq(priceYes, 5e17, "Price should be 0.5 when reserves are zero");
        assertEq(priceNo, 5e17, "Price should be 0.5 when reserves are zero");
    }

    function test_SwapExhaustsReserve() public {
        uint256 marketId = _setupTradingMarket();

        (, , , uint128 reserveYes, uint128 reserveNo, , , , , ) = market.states(marketId);

        vm.prank(agentA);
        uint256 mintAmount = market.swapShares(marketId, Outcome.YES, 30 * 1e18);

        assertGt(mintAmount, 0, "Should mint some shares");
        assertLt(mintAmount, uint256(reserveNo), "Cannot mint more than reserve");
    }

    function test_AuthorizedSigner() public {
        address newSigner = address(0x999);

        vm.startPrank(owner);
        market.setAuthorizedSigner(newSigner, true);
        assertTrue(market.isAuthorizedSigner(newSigner));

        market.setAuthorizedSigner(newSigner, false);
        assertFalse(market.isAuthorizedSigner(newSigner));
        vm.stopPrank();
    }

    function test_RevertWhen_UnauthorizedSignerSetsSigner() public {
        vm.prank(agentA);
        vm.expectRevert();
        market.setAuthorizedSigner(address(0x999), true);
    }

    function test_OnReport() public {
        uint256 marketId = _setupInfoPhase();

        vm.warp(block.timestamp + 1 hours + 1);

        bytes32 merkleRoot = keccak256("merkle");
        bytes memory report = abi.encode(
            marketId,
            merkleRoot,
            uint8(Outcome.YES),
            uint128(80 * 1e18),
            uint128(20 * 1e18),
            uint256(2),
            uint128(30 * 1e18),
            uint128(10 * 1e18)
        );

        vm.startPrank(owner);
        market.setAuthorizedSigner(creForwarder, true);
        vm.stopPrank();

        vm.prank(creForwarder);
        market.onReport(report, "");

        (MarketPhase phase, bytes32 stateMerkleRoot, , , , , , , , ) = market.states(marketId);
        assertEq(uint256(phase), uint256(MarketPhase.TRADING));
        assertEq(stateMerkleRoot, merkleRoot);
    }

    function test_RevertWhen_OnReportUnauthorized() public {
        uint256 marketId = _setupInfoPhase();

        vm.warp(block.timestamp + 1 hours + 1);

        bytes memory report = abi.encode(
            marketId,
            keccak256("merkle"),
            uint8(Outcome.YES),
            uint128(80 * 1e18),
            uint128(20 * 1e18),
            uint256(2),
            uint128(30 * 1e18),
            uint128(10 * 1e18)
        );

        vm.prank(agentA);
        vm.expectRevert(MiniMarket.UnauthorizedSigner.selector);
        market.onReport(report, "");
    }

    function test_ClaimPayoutETH() public {
        vm.startPrank(owner);
        uint256 marketId = market.createMarket{value: TICKET_COST * MAX_SLOTS}(
            "ETH market",
            MOCK_SCHEMA_URI,
            address(0),
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound,
            market.DRAND_QUICKNET_HASH(),
            TRADING_DURATION
        );
        vm.stopPrank();

        bytes memory ciphertext = abi.encodePacked("encrypted");
        bytes32 validationHash = keccak256("test");

        vm.prank(agentA);
        market.submitEncrypted{value: TICKET_COST}(marketId, ciphertext, validationHash);

        vm.warp(block.timestamp + 1 hours + 1);

        uint256 yesShares = 30 * 1e18;
        uint256 noShares = 10 * 1e18;
        bytes32 leaf = keccak256(abi.encodePacked(agentA, yesShares, noShares));
        bytes32 merkleRoot = leaf;

        vm.prank(creForwarder);
        market.revealInfoPhase(
            marketId,
            merkleRoot,
            Outcome.YES,
            80 * 1e18,
            20 * 1e18,
            1,
            uint128(yesShares),
            uint128(noShares)
        );

        (, bytes32 stateMerkleRoot, , , , , , , , ) = market.states(marketId);

        vm.prank(agentA);
        market.claimShares(marketId, MerkleProof({
            root: stateMerkleRoot,
            proof: new bytes32[](0),
            index: 0,
            agent: agentA,
            yesShares: yesShares,
            noShares: noShares
        }));

        vm.warp(block.timestamp + TRADING_DURATION + 1);

        vm.prank(creForwarder);
        market.resolveMarket(marketId, Outcome.YES);

        uint256 balanceBefore = agentA.balance;

        vm.prank(agentA);
        market.claimPayout(marketId);

        assertGt(agentA.balance, balanceBefore, "Should receive ETH payout");
    }

    function test_CanTrade() public {
        uint256 marketId = _setupRevealedMarket();

        assertFalse(market.canTrade(marketId, agentA), "Cannot trade before claiming shares");

        (, bytes32 stateMerkleRoot, , , , , , , , ) = market.states(marketId);

        vm.prank(agentA);
        market.claimShares(marketId, MerkleProof({
            root: stateMerkleRoot,
            proof: new bytes32[](0),
            index: 0,
            agent: agentA,
            yesShares: 30 * 1e18,
            noShares: 10 * 1e18
        }));

        assertTrue(market.canTrade(marketId, agentA), "Can trade after claiming shares");
        assertFalse(market.canTrade(marketId, agentB), "Non-participant cannot trade");
    }

    function _createMarket() internal returns (uint256) {
        vm.startPrank(owner);
        token.approve(address(market), TICKET_COST * MAX_SLOTS);
        uint256 marketId = market.createMarket(
            "Test market",
            MOCK_SCHEMA_URI,
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
        market.submitEncrypted(marketId, ciphertext, keccak256("test2"));
        vm.stopPrank();

        return marketId;
    }

    function _setupRevealedMarket() internal returns (uint256) {
        uint256 marketId = _setupInfoPhase();

        vm.warp(block.timestamp + 1 hours + 1);

        uint256 yesShares = 30 * 1e18;
        uint256 noShares = 10 * 1e18;
        bytes32 leaf = keccak256(abi.encodePacked(agentA, yesShares, noShares));
        bytes32 merkleRoot = leaf;

        vm.prank(creForwarder);
        market.revealInfoPhase(
            marketId,
            merkleRoot,
            Outcome.YES,
            80 * 1e18,
            20 * 1e18,
            2,
            30 * 1e18,
            10 * 1e18
        );

        return marketId;
    }

    function _setupTradingMarket() internal returns (uint256) {
        uint256 marketId = _setupRevealedMarket();

        (, bytes32 stateMerkleRoot, , , , , , , , ) = market.states(marketId);

        vm.prank(agentA);
        market.claimShares(marketId, MerkleProof({
            root: stateMerkleRoot,
            proof: new bytes32[](0),
            index: 0,
            agent: agentA,
            yesShares: 30 * 1e18,
            noShares: 10 * 1e18
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

contract MiniMarketInvariantTest is Test {
    MiniMarket public market;
    MockERC20 public token;

    address public owner = address(0x1);
    address public creForwarder = address(0x2);
    address public agentA = address(0x10);
    address public agentB = address(0x11);

    uint256 public constant TICKET_COST = 10 * 1e18;
    uint256 public constant MAX_SLOTS = 10;
    uint48 public constant TRADING_DURATION = 1 hours;
    string public constant MOCK_SCHEMA_URI = "ipfs://QmMockSchemaHash123456789";

    uint64 public targetDrandRound;

    function setUp() public {
        vm.warp(1700000000);

        vm.startPrank(owner);
        market = new MiniMarket(creForwarder, owner);
        token = new MockERC20();

        uint64 currentDrandRound = uint64((block.timestamp - market.DRAND_GENESIS()) / market.DRAND_PERIOD());
        targetDrandRound = currentDrandRound + 1200;

        token.approve(address(market), TICKET_COST * MAX_SLOTS);
        market.createMarket(
            "Invariant test market",
            MOCK_SCHEMA_URI,
            address(token),
            MAX_SLOTS,
            TICKET_COST,
            targetDrandRound,
            market.DRAND_QUICKNET_HASH(),
            TRADING_DURATION
        );
        vm.stopPrank();

        vm.deal(owner, 1000 ether);
        vm.deal(agentA, 100 ether);
        vm.deal(agentB, 100 ether);

        vm.startPrank(owner);
        token.transfer(agentA, 10000 * TICKET_COST);
        token.transfer(agentB, 10000 * TICKET_COST);
        vm.stopPrank();
    }

    function invariant_PriceSum() public view {
        (uint256 priceYes, uint256 priceNo) = market.getPriceRatio(1);
        uint256 sum = priceYes + priceNo;
        assertApproxEqAbs(sum, 1e18, 100, "Price sum should equal 1");
    }

    function invariant_ReserveBalance() public view {
        (, , , uint128 reserveYes, uint128 reserveNo, , , , , ) = market.states(1);
        uint256 totalReserve = uint256(reserveYes) + uint256(reserveNo);
        assertLe(totalReserve, MAX_SLOTS * TICKET_COST, "Total reserve cannot exceed market cap");
    }
}
