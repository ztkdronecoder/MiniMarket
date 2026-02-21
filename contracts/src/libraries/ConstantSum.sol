// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library ConstantSum {
    uint256 internal constant PRECISION = 1e18;

    function calculatePrices(
        uint256 reserveYes,
        uint256 reserveNo
    ) internal pure returns (uint256 priceYes, uint256 priceNo) {
        uint256 totalReserve = reserveYes + reserveNo;
        if (totalReserve == 0) return (PRECISION / 2, PRECISION / 2);
        
        priceYes = (reserveNo * PRECISION) / totalReserve;
        priceNo = (reserveYes * PRECISION) / totalReserve;
    }

    function calculateSwapOutput(
        uint256 reserveBurn,
        uint256 reserveMint,
        uint256 burnAmount
    ) internal pure returns (uint256 mintAmount) {
        if (reserveBurn == 0 || reserveMint == 0 || burnAmount == 0) {
            return 0;
        }

        uint256 totalReserve = reserveBurn + reserveMint;
        
        uint256 priceBurn = (reserveMint * PRECISION) / totalReserve;
        uint256 priceMint = (reserveBurn * PRECISION) / totalReserve;
        
        if (priceMint == 0) {
            return 0;
        }
        
        mintAmount = (burnAmount * priceBurn) / priceMint;
        
        if (mintAmount > reserveMint) {
            mintAmount = reserveMint;
        }
    }

    function validatePriceSum(
        uint256 priceYes,
        uint256 priceNo
    ) internal pure returns (bool) {
        uint256 sum = priceYes + priceNo;
        return sum >= PRECISION - 100 && sum <= PRECISION + 100;
    }

    function calculateValue(
        uint256 shares,
        uint256 price
    ) internal pure returns (uint256) {
        return (shares * price) / PRECISION;
    }
}
