// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IReceiver - receives keystone reports from Chainlink Forwarder
/// @notice Implementations must support the IReceiver interface through ERC165.
/// @dev See https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts
interface IReceiver is IERC165 {
    /// @notice Handles incoming keystone reports from the Forwarder.
    /// @param metadata Report's metadata (workflowId, workflowName, workflowOwner).
    /// @param report Workflow report payload (ABI-encoded).
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
