// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {Cortex} from "../src/Cortex.sol";
import {OrderbookMarket} from "../src/OrderbookMarket.sol";
import {SPDC} from "../src/SPDC.sol";

/**
 * @notice Deploy using a raw private key (PRIVATE_KEY env var)
 * Usage: forge script script/Deploy.s.sol:DeployCortex --rpc-url <url> --broadcast
 */
contract DeployCortex is Script {
    function run() external returns (Cortex) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address creForwarder = vm.envOr("CRE_FORWARDER", SPDC.SIMULATION_FORWARDER_BASE_SEPOLIA);
        address usdc = vm.envOr("USDC", SPDC.USDC_BASE_SEPOLIA);

        vm.startBroadcast(deployerPrivateKey);

        Cortex market = new Cortex(creForwarder, vm.addr(deployerPrivateKey), usdc);
        OrderbookMarket orderbook = new OrderbookMarket(address(market));
        market.setOrderbook(address(orderbook));

        console.log("Cortex deployed at:", address(market));
        console.log("OrderbookMarket deployed at:", address(orderbook));
        console.log("CRE Forwarder:", creForwarder);
        console.log("USDC:", usdc);
        console.log("Owner:", market.owner());

        vm.stopBroadcast();

        return market;
    }
}

/**
 * @notice Deploy to Base Sepolia using keystore (no private key env var needed)
 * Usage: forge script script/Deploy.s.sol:DeployCortexSepolia \
 *          --rpc-url base_sepolia \
 *          --keystore ~/.foundry/keystore/chack \
 *          --broadcast
 */
contract DeployCortexSepolia is Script {
    function run() external returns (Cortex) {
        address creForwarder = vm.envOr("CRE_FORWARDER", SPDC.SIMULATION_FORWARDER_BASE_SEPOLIA);
        address usdc = vm.envOr("USDC", SPDC.USDC_BASE_SEPOLIA);
        // When OWNER is set (e.g. for anvil fork), use it so owner matches keystore/broadcaster
        address owner = vm.envOr("OWNER", msg.sender);

        vm.startBroadcast();

        Cortex market = new Cortex(creForwarder, owner, usdc);
        OrderbookMarket orderbook = new OrderbookMarket(address(market));
        market.setOrderbook(address(orderbook));

        console.log("Cortex deployed at:", address(market));
        console.log("OrderbookMarket deployed at:", address(orderbook));
        console.log("CRE Forwarder:", creForwarder);
        console.log("USDC:", usdc);
        console.log("Owner:", market.owner());
        console.log("Chain ID:", block.chainid);

        vm.stopBroadcast();

        return market;
    }
}

contract DeployCortexLocal is Script {
    function run() external returns (Cortex) {
        address creForwarder = address(0x1);
        // Deployer is owner so they can setOrderbook
        address owner = vm.addr(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80);
        address usdc = address(0x3);

        vm.startBroadcast(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80);

        Cortex market = new Cortex(creForwarder, owner, usdc);
        OrderbookMarket orderbook = new OrderbookMarket(address(market));
        market.setOrderbook(address(orderbook));

        console.log("Cortex deployed at:", address(market));
        console.log("OrderbookMarket deployed at:", address(orderbook));
        console.log("CRE Forwarder:", creForwarder);
        console.log("USDC:", usdc);
        console.log("Owner:", owner);

        vm.stopBroadcast();

        return market;
    }
}
