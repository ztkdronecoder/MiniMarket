// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script} from "forge-std/Script.sol";
import "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Fund addresses with USDC on a forked network.
 * Call with --sender $USDC_WHALE after: cast rpc anvil_impersonateAccount $USDC_WHALE
 *
 * Usage:
 *   cast rpc anvil_impersonateAccount $USDC_WHALE
 *   forge script script/FundUSDC.s.sol:FundUSDC --rpc-url $RPC --broadcast --sender $USDC_WHALE
 *
 * Environment:
 *   USDC_ADDRESS   USDC token (default: Base Sepolia)
 *   USDC_WHALE     Address with USDC (must impersonate first)
 *   AMOUNT         Amount per address in 6 decimals (default: 1000e6)
 *   CREATOR_ADDRESS Optional: also fund this address
 */
contract FundUSDC is Script {
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    address[] ADDRESSES = [
        0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266,
        0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
        0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,
        0x90F79bf6EB2c4f870365E785982E1f101E93b906,
        0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65,
        0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc,
        0x976EA74026E726554dB657fA54763abd0C3a0aa9,
        0x14dC79964da2C08b23698B3D3cc7Ca32193d9955,
        0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f,
        0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
    ];

    function run() external {
        address usdc = vm.envOr("USDC_ADDRESS", USDC_BASE_SEPOLIA);
        address whale = vm.envAddress("USDC_WHALE");
        uint256 amount = vm.envOr("AMOUNT", uint256(1000 * 1e6));

        vm.startBroadcast(whale);

        for (uint256 i = 0; i < ADDRESSES.length; i++) {
            IERC20(usdc).transfer(ADDRESSES[i], amount);
            console.log("Funded", ADDRESSES[i], amount / 1e6);
        }

        address creator = vm.envOr("CREATOR_ADDRESS", address(0));
        if (creator != address(0)) {
            IERC20(usdc).transfer(creator, amount);
            console.log("Funded creator", creator, amount / 1e6);
        }

        vm.stopBroadcast();
    }
}
