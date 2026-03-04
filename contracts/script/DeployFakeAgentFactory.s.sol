// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {FakeAgentFactory} from "../src/FakeAgentFactory.sol";

/**
 * @notice Deploy FakeAgentFactory to Base Sepolia (or any network).
 *
 * Usage (keystore):
 *   forge script script/DeployFakeAgentFactory.s.sol:DeployFakeAgentFactory \
 *     --rpc-url base_sepolia \
 *     --keystore ~/.foundry/keystores/chack \
 *     --broadcast
 */
contract DeployFakeAgentFactory is Script {
    function run() external returns (FakeAgentFactory factory) {
        vm.startBroadcast();

        factory = new FakeAgentFactory();

        vm.stopBroadcast();

        console.log("FakeAgentFactory deployed at:", address(factory));
        console.log("Deployer (controller):", factory.deployer());
        console.log("Chain ID:", block.chainid);

        // Print precomputed agent addresses 0-4 for visibility
        for (uint256 i = 0; i < 5; i++) {
            console.log(string.concat("  Agent[", vm.toString(i), "]:"), factory.getAgentAddress(i));
        }

        // Write address to deployed-addresses.json (root of monorepo, two levels up from contracts/)
        string memory jsonKey = block.chainid == 84532 ? "baseSepolia" : "localhost";
        string memory outPath = string.concat(vm.projectRoot(), "/../deployed-addresses.json");
        // Best-effort write: silently skip if file doesn't support vm.writeJson
        try vm.readFile(outPath) returns (string memory existing) {
            vm.writeJson(vm.toString(address(factory)), outPath, string.concat(".", jsonKey, ".FakeAgentFactory"));
            console.log("Updated deployed-addresses.json");
            // suppress unused variable warning
            existing;
        } catch {}
    }
}
