// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IReceiver} from "./IReceiver.sol";

/// @dev Extends IReceiver for Chainlink Forwarder. Keeps optional signer management.
interface ICREReceiver is IReceiver {
    function setAuthorizedSigner(address signer, bool authorized) external;

    function isAuthorizedSigner(address signer) external view returns (bool);
}
