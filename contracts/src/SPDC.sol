// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @dev Shared constants for Base Sepolia deployment.
///      Used by Deploy.s.sol as env-var fallback defaults.
library SPDC {
    /// @dev Base Sepolia USDC token address
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    /// @dev Base Sepolia CRE simulation forwarder (ethereum-testnet-sepolia-base-1)
    address constant SIMULATION_FORWARDER_BASE_SEPOLIA = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;
}
