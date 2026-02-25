// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library SPDC {
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    /// @dev Base Sepolia simulation forwarder (ethereum-testnet-sepolia-base-1)
    address constant SIMULATION_FORWARDER_BASE_SEPOLIA = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;
}

library BaseSepoliaAddresses {
    address constant MINIMARKET = address(0);
    address constant CRE_FORWARDER = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
}

library LocalhostAddresses {
    address constant MINIMARKET = 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512;
    address constant CRE_FORWARDER = 0x0000000000000000000000000000000000000001;
    address constant MOCK_TOKEN = 0x5FbDB2315678afecb367f032d93F642f64180aa3;
}
