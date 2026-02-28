// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {MiniMarket} from "../src/MiniMarket.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CreateMarket is Script {
    MiniMarket public market;

    bytes32 constant DRAND_QUICKNET_HASH = 0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971;
    uint64 constant DRAND_GENESIS = 1692803367;
    uint64 constant DRAND_PERIOD = 3;

    function _currentDrandRound() internal view returns (uint64) {
        return uint64((block.timestamp - DRAND_GENESIS) / DRAND_PERIOD);
    }

    // Config is split into a struct to avoid stack-too-deep in run()
    struct MarketParams {
        uint256 maxSlots;
        uint256 ticketCost;
        uint256 creatorOffer;
        uint48  tradingDuration;
        uint64  targetRound;
        uint256 optionCount;
    }

    function _loadParams() internal view returns (MarketParams memory p) {
        p.maxSlots        = vm.envOr("MAX_SLOTS",        uint256(10));
        p.ticketCost      = vm.envOr("TICKET_COST",      uint256(1e6)); // 1 USDC (6 decimals)
        p.creatorOffer    = vm.envOr("CREATOR_OFFER",    uint256(0));
        p.tradingDuration = uint48(vm.envOr("TRADING_DURATION", uint256(86400)));
        p.targetRound     = uint64(vm.envOr("DRAND_TARGET_ROUND", uint256(_currentDrandRound() + 20)));
        p.optionCount     = vm.envOr("OPTION_COUNT",     uint256(0));
    }

    function run() external returns (uint256 marketId) {
        market = MiniMarket(payable(vm.envAddress("MARKET_ADDRESS")));

        string memory question  = vm.envOr("QUESTION",   string("Will BTC exceed $100,000 by March 2026?"));
        string memory schemaJson = vm.envOr("SCHEMA_JSON", string('{"version":"1.0","type":"ai","description":"","deadline":0,"fallback":{"type":"ai","provider":"gemini","prompt":""}}'));
        MarketParams memory p   = _loadParams();

        uint256 marketCap = p.maxSlots * p.ticketCost;
        uint256 totalDeposit = marketCap + p.creatorOffer;

        vm.startBroadcast();

        IERC20(market.USDC()).approve(address(market), totalDeposit);
        marketId = market.createMarket(
            question,
            schemaJson,
            p.maxSlots,
            p.ticketCost,
            p.creatorOffer,
            p.targetRound,
            DRAND_QUICKNET_HASH,
            p.tradingDuration,
            p.optionCount
        );

        console.log("Market created with ID:", marketId);
        console.log("Question:", question);
        console.log("Schema JSON:", schemaJson);
        console.log("USDC:", market.USDC());
        console.log("Max slots:", p.maxSlots);
        console.log("Ticket cost (wei):", p.ticketCost);
        console.log("Creator offer (wei):", p.creatorOffer);
        console.log("Total deposit (wei):", totalDeposit);
        console.log("Drand target round:", p.targetRound);
        console.log("Trading duration (s):", p.tradingDuration);

        vm.stopBroadcast();

        return marketId;
    }
}

contract CreateMarketBTC is Script {
    MiniMarket public market;
    
    bytes32 constant DRAND_QUICKNET_HASH = 0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971;
    uint64 constant DRAND_GENESIS = 1692803367;
    uint64 constant DRAND_PERIOD = 3;

    function _currentDrandRound() internal view returns (uint64) {
        return uint64((block.timestamp - DRAND_GENESIS) / DRAND_PERIOD);
    }

    function run() external returns (uint256 marketId) {
        market = MiniMarket(vm.envAddress("MARKET_ADDRESS"));

        string memory question = "Is Bitcoin price above $95,000 USD right now?";
        string memory schemaJson = '{"type":"mock","source":"btc-price"}';
        uint256 maxSlots = 10;
        uint256 ticketCost = 0.1 ether; // 0.1e18 for 18-decimal token; use 0.1e6 for USDC
        uint256 creatorOffer = 0;
        uint64 targetRound = _currentDrandRound() + 20;
        uint48 tradingDuration = 300;
        uint256 totalDeposit = maxSlots * ticketCost + creatorOffer;

        vm.startBroadcast();

        IERC20(market.USDC()).approve(address(market), totalDeposit);
        marketId = market.createMarket(
            question,
            schemaJson,
            maxSlots,
            ticketCost,
            creatorOffer,
            targetRound,
            DRAND_QUICKNET_HASH,
            tradingDuration,
            0  // optionCount: 0 = single implicit submarket
        );

        console.log("=== BTC Market Created ===");
        console.log("Market ID:", marketId);
        console.log("Question:", question);
        console.log("Schema JSON:", schemaJson);
        console.log("USDC:", market.USDC());
        console.log("Drand target round:", targetRound);
        console.log("Trading duration (s):", tradingDuration);

        vm.stopBroadcast();

        return marketId;
    }
}
