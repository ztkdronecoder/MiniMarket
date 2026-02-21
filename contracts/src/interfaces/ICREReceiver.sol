// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface ICREReceiver {
    function onReport(
        bytes calldata report,
        bytes calldata extraData
    ) external;

    function setAuthorizedSigner(address signer, bool authorized) external;

    function isAuthorizedSigner(address signer) external view returns (bool);
}
