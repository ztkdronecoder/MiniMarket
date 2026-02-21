// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library MerkleVerifier {
    function verify(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf,
        uint256 index
    ) internal pure returns (bool) {
        bytes32 hash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];

            if (index % 2 == 0) {
                hash = keccak256(abi.encodePacked(hash, proofElement));
            } else {
                hash = keccak256(abi.encodePacked(proofElement, hash));
            }

            index = index / 2;
        }

        return hash == root;
    }

    function hashLeaf(
        address agent,
        uint8 outcome,
        uint256 allocatedShares
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(agent, outcome, allocatedShares));
    }
}
