// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {MiniMarket} from "../src/MiniMarket.sol";
import {SPDC} from "../src/SPDC.sol";

contract DeployMiniMarket is Script {
    function run() external returns (MiniMarket) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address creForwarder = vm.envOr("CRE_FORWARDER", SPDC.CRE_FORWARDER_BASE_SEPOLIA);

        vm.startBroadcast(deployerPrivateKey);

        MiniMarket market = new MiniMarket(creForwarder, vm.addr(deployerPrivateKey));

        console.log("MiniMarket deployed at:", address(market));
        console.log("CRE Forwarder:", creForwarder);
        console.log("Owner:", market.owner());

        vm.stopBroadcast();

        return market;
    }
}

contract DeployMiniMarketLocal is Script {
    function run() external returns (MiniMarket) {
        address creForwarder = address(0x1);
        address owner = address(0x2);

        vm.startBroadcast(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80);

        MiniMarket market = new MiniMarket(creForwarder, owner);

        console.log("MiniMarket deployed at:", address(market));
        console.log("CRE Forwarder:", creForwarder);
        console.log("Owner:", owner);

        vm.stopBroadcast();

        return market;
    }
}
