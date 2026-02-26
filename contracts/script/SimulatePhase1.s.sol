// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {MiniMarket} from "../src/MiniMarket.sol";
import {MarketPhase} from "../src/interfaces/IMarket.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Submit a simulated (unencrypted) Phase 1 prediction for a given market.
 *
 * The ciphertext is a plaintext JSON payload instead of real tlock ciphertext.
 * This lets you test the full contract interaction flow without running the
 * TypeScript encryption layer. The submission will be accepted by the contract
 * but the CRE will not be able to decrypt it — use only on testnet.
 *
 * Env vars:
 *   MARKET_ADDRESS  address of the deployed MiniMarket
 *   MARKET_ID       ID of the market to participate in
 *   OUTCOME         1 = YES, 2 = NO  (default: 1)
 */
contract SimulatePhase1 is Script {

    // Matches CREWorkflow.computeValidationHash() in ts/src/cre/workflow.ts:
    //   keccak256(abi.encode(uint8 outcome, address agent, bytes32 salt))
    function _validationHash(uint8 outcome, address agent, bytes32 salt)
        internal pure returns (bytes32)
    {
        return keccak256(abi.encode(outcome, agent, salt));
    }

    struct MarketInfo {
        string   question;
        uint256  maxSlots;
        uint256  ticketCost;
        uint64   drandTargetRound;
    }

    function _readMarketInfo(MiniMarket market, uint256 marketId)
        internal view returns (MarketInfo memory info)
    {
        (
            ,
            string memory q,
            ,
            uint256 ms,
            uint256 tc,
            ,
            ,  // creatorOffer
            uint64 dtr,
            ,
            ,
        ) = market.configs(marketId);

        info.question         = q;
        info.maxSlots         = ms;
        info.ticketCost       = tc;
        info.drandTargetRound = dtr;
    }

    function run() external {
        MiniMarket market = MiniMarket(payable(vm.envAddress("MARKET_ADDRESS")));
        uint256 marketId  = vm.envUint("MARKET_ID");
        uint8   outcome   = uint8(vm.envOr("OUTCOME", uint256(1)));

        require(outcome == 1 || outcome == 2, "OUTCOME must be 1 (YES) or 2 (NO)");

        // ── Validate phase ────────────────────────────────────────────────────
        (MarketPhase phase, , , , , , , , , , ) = market.states(marketId);
        require(phase == MarketPhase.INFO_COLLECTION, "Market is not in INFO_COLLECTION phase");

        // ── Read market details ───────────────────────────────────────────────
        MarketInfo memory info = _readMarketInfo(market, marketId);
        uint256 slotsFilled    = market.getSubmissionCount(marketId);

        // ── Build simulation payload ─────────────────────────────────────────
        // salt is deterministic per (sender, marketId, block) so re-runs differ
        bytes32 salt = keccak256(abi.encodePacked(block.timestamp, msg.sender, marketId));

        // Ciphertext: plaintext JSON mimicking PredictionPayload shape.
        // Real ciphertext would be tlock-encrypted — this is simulation only.
        bytes memory ciphertext = abi.encodePacked(
            '{"simulation":true,"outcome":',
            outcome == 1 ? '"YES"' : '"NO"',
            ',"agent":"',
            vm.toString(msg.sender),
            '","salt":"',
            vm.toString(salt),
            '"}'
        );

        bytes32 validationHash = _validationHash(outcome, msg.sender, salt);

        // ── Log before broadcast ──────────────────────────────────────────────
        console.log("=== Phase 1 Simulation ===");
        console.log("Market ID       :", marketId);
        console.log("Question        :", info.question);
        console.log("Outcome         :", outcome == 1 ? "YES" : "NO");
        console.log("Ticket cost     :", info.ticketCost);
        console.log("Drand round     :", info.drandTargetRound);
        console.log("Slots filled    :", slotsFilled);
        console.log("Slots remaining :", info.maxSlots - slotsFilled);
        console.log("Validation hash :", vm.toString(validationHash));

        // ── Submit ────────────────────────────────────────────────────────────
        vm.startBroadcast();

        IERC20(market.USDC()).approve(address(market), info.ticketCost);
        market.submitEncrypted(
            marketId,
            ciphertext,
            validationHash
        );

        vm.stopBroadcast();

        uint256 newCount = market.getSubmissionCount(marketId);
        console.log("=== Submitted! ===");
        console.log("Slots now filled:", newCount);
        console.log("Slots remaining :", info.maxSlots - newCount);
    }
}
