// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {MiniMarket} from "../src/MiniMarket.sol";

contract CreateMarket is Script {
    MiniMarket public market;
    
    bytes32 constant DRAND_QUICKNET_HASH = 0xdbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3ccac746459b582;
    uint64 constant DRAND_GENESIS = 1692803367;
    uint64 constant DRAND_PERIOD = 3;

    function _currentDrandRound() internal view returns (uint64) {
        return uint64((block.timestamp - DRAND_GENESIS) / DRAND_PERIOD);
    }

    function run() external returns (uint256 marketId) {
        address payable marketAddress = payable(vm.envAddress("MARKET_ADDRESS"));
        market = MiniMarket(marketAddress);

        uint256 maxSlots = vm.envOr("MAX_SLOTS", uint256(10));
        uint256 ticketCost = vm.envOr("TICKET_COST", uint256(0.1 ether));
        uint48 tradingDuration = uint48(vm.envOr("TRADING_DURATION", uint256(300)));
        string memory question = vm.envOr("QUESTION", string("Will BTC exceed $100,000 by March 2026?"));
        string memory schemaURI = vm.envOr("SCHEMA_URI", string("mock://btc-price"));

        uint64 targetRound = uint64(vm.envOr("DRAND_TARGET_ROUND", uint256(_currentDrandRound() + 20)));

        uint256 totalFunding = maxSlots * ticketCost;

        vm.startBroadcast();
        
        marketId = market.createMarket{value: totalFunding}(
            question,
            schemaURI,
            address(0),
            maxSlots,
            ticketCost,
            targetRound,
            DRAND_QUICKNET_HASH,
            tradingDuration
        );

        console.log("Market created with ID:", marketId);
        console.log("Question:", question);
        console.log("Schema URI:", schemaURI);
        console.log("Max slots:", maxSlots);
        console.log("Ticket cost:", ticketCost);
        console.log("Drand target round:", targetRound);
        console.log("Trading duration:", tradingDuration);

        vm.stopBroadcast();

        return marketId;
    }
}

contract CreateMarketBTC is Script {
    MiniMarket public market;
    
    bytes32 constant DRAND_QUICKNET_HASH = 0xdbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3ccac746459b582;
    uint64 constant DRAND_GENESIS = 1692803367;
    uint64 constant DRAND_PERIOD = 3;

    function _currentDrandRound() internal view returns (uint64) {
        return uint64((block.timestamp - DRAND_GENESIS) / DRAND_PERIOD);
    }

    function run() external returns (uint256 marketId) {
        address payable marketAddress = payable(vm.envAddress("MARKET_ADDRESS"));
        market = MiniMarket(marketAddress);

        string memory question = "Is Bitcoin price above $95,000 USD right now?";
        string memory schemaURI = "mock://btc-price";
        uint256 maxSlots = 10;
        uint256 ticketCost = 0.1 ether;
        uint64 targetRound = _currentDrandRound() + 20;
        uint48 tradingDuration = 300;

        uint256 totalFunding = maxSlots * ticketCost;

        vm.startBroadcast();
        
        marketId = market.createMarket{value: totalFunding}(
            question,
            schemaURI,
            address(0),
            maxSlots,
            ticketCost,
            targetRound,
            DRAND_QUICKNET_HASH,
            tradingDuration
        );

        console.log("=== BTC Market Created ===");
        console.log("Market ID:", marketId);
        console.log("Question:", question);
        console.log("Schema URI:", schemaURI);
        console.log("Drand target round:", targetRound);
        console.log("Trading duration (s):", tradingDuration);

        vm.stopBroadcast();

        return marketId;
    }
}
