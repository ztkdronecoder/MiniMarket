// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IMarket} from "./interfaces/IMarket.sol";

/**
 * @title OrderbookMarket
 * @notice P2P orderbook for YES <-> NO share trading. Only Phase 1 participants can trade.
 * @dev Shares are internal to MiniMarket (mappings), not ERC20. No token transfers for shares.
 */
contract OrderbookMarket {
    uint256 public constant PRECISION = 1e18;

    IMarket public immutable market;

    struct Order {
        address maker;
        uint256 marketId;
        bool sellYes;       // true = sell YES for NO, false = sell NO for YES
        uint256 amount;     // shares to sell
        uint256 price;      // PRECISION: amount of other outcome per 1 share (e.g. 0.6e18 = 1 YES costs 0.6 NO)
        bool filled;
        bool cancelled;
    }

    Order[] public orders;

    event OrderPlaced(uint256 indexed orderId, address indexed maker, uint256 marketId, bool sellYes, uint256 amount, uint256 price);
    event OrderCancelled(uint256 indexed orderId);
    event OrderFilled(uint256 indexed orderId, address indexed taker, uint256 sharesAmount, uint256 takerPaysAmount);

    error OrderNotFound();
    error OrderFilledOrCancelled();
    error NotOrderMaker();
    error InvalidPrice();
    error TradingEnded();

    constructor(address _market) {
        market = IMarket(_market);
    }

    /**
     * @notice Place a limit order (sell YES for NO, or sell NO for YES)
     * @param marketId Market ID
     * @param sellYes True to sell YES shares for NO, false to sell NO for YES
     * @param amount Amount of shares to sell
     * @param price PRECISION-scaled: how many of the other outcome per 1 share (e.g. 0.6e18 = 1 share costs 0.6 of the other)
     */
    function placeOrder(
        uint256 marketId,
        bool sellYes,
        uint256 amount,
        uint256 price
    ) external returns (uint256 orderId) {
        require(amount > 0, "Zero amount");
        require(price > 0 && price <= PRECISION, InvalidPrice());
        require(market.canTrade(marketId, msg.sender), "Cannot trade");

        _requireTradingActive(marketId);

        orderId = orders.length;
        orders.push(Order({
            maker: msg.sender,
            marketId: marketId,
            sellYes: sellYes,
            amount: amount,
            price: price,
            filled: false,
            cancelled: false
        }));

        emit OrderPlaced(orderId, msg.sender, marketId, sellYes, amount, price);
    }

    /**
     * @notice Cancel an open order
     */
    function cancelOrder(uint256 orderId) external {
        if (orderId >= orders.length) revert OrderNotFound();
        Order storage o = orders[orderId];
        if (o.filled || o.cancelled) revert OrderFilledOrCancelled();
        if (o.maker != msg.sender) revert NotOrderMaker();

        o.cancelled = true;
        emit OrderCancelled(orderId);
    }

    /**
     * @notice Take an order (fully fill). Taker pays the other outcome, receives the sold shares.
     * @param orderId Order to take
     */
    function takeOrder(uint256 orderId) external {
        if (orderId >= orders.length) revert OrderNotFound();
        Order storage o = orders[orderId];
        if (o.filled || o.cancelled) revert OrderFilledOrCancelled();
        require(o.maker != msg.sender, "Cannot take own order");
        require(market.canTrade(o.marketId, msg.sender), "Cannot trade");

        _requireTradingActive(o.marketId);

        uint256 takerPaysAmount = (o.amount * o.price) / PRECISION;
        require(takerPaysAmount > 0, "Zero output");

        o.filled = true;

        market.executeOrderbookTrade(
            o.marketId,
            o.maker,
            msg.sender,
            o.sellYes,
            o.amount,
            takerPaysAmount
        );

        emit OrderFilled(orderId, msg.sender, o.amount, takerPaysAmount);
    }

    function getOrder(uint256 orderId) external view returns (
        address maker,
        uint256 marketId,
        bool sellYes,
        uint256 amount,
        uint256 price,
        bool filled,
        bool cancelled
    ) {
        if (orderId >= orders.length) revert OrderNotFound();
        Order storage o = orders[orderId];
        return (o.maker, o.marketId, o.sellYes, o.amount, o.price, o.filled, o.cancelled);
    }

    function getOrderCount() external view returns (uint256) {
        return orders.length;
    }

    function _requireTradingActive(uint256 /* marketId */) internal pure {
        // Phase check happens in MiniMarket.executeOrderbookTrade
    }
}
