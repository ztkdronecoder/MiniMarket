// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library Quadratic {
    uint256 internal constant CONSENSUS_MULTIPLIER = 4;
    uint256 internal constant NON_CONSENSUS_MULTIPLIER = 1;

    function calculateShareAllocation(
        uint256 baseShares,
        bool isConsensus
    ) internal pure returns (uint256) {
        uint256 multiplier = isConsensus ? CONSENSUS_MULTIPLIER : NON_CONSENSUS_MULTIPLIER;
        return baseShares * multiplier;
    }

    function calculateReputationDelta(
        uint256 allocatedShares
    ) internal pure returns (uint256) {
        return sqrt(allocatedShares);
    }

    function calculateEffectiveWeight(
        uint256 allocatedShares,
        uint256 reputation
    ) internal pure returns (uint256) {
        return allocatedShares * sqrt(reputation);
    }

    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        if (x == 1) return 1;

        uint256 z = (x + 1) / 2;
        uint256 y = x;
        
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        
        return y;
    }

    function computeConsensus(
        uint256 yesCount,
        uint256 noCount
    ) internal pure returns (uint8) {
        if (yesCount > noCount) return 1;
        if (noCount > yesCount) return 2;
        return 0;
    }
}
