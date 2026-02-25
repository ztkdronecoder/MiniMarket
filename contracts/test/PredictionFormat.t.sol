// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

contract PredictionFormatTest is Test {
    using stdStorage for StdStorage;

    uint256 constant PRECISION = 1e18;
    uint256 constant BASIS_POINTS = 10000;

    event PredictionSubmitted(
        uint256 indexed marketId,
        address indexed agent,
        bytes32 validationHash,
        bytes ciphertext
    );

    event InfoRevealed(
        uint256 indexed marketId,
        bytes32 merkleRoot,
        uint8 consensusOutcome,
        string merkleDataURI,
        uint256 totalSubmissions
    );

    function setUp() public {}

    struct Prediction {
        address agent;
        uint256 yesPercent;
        uint256 noPercent;
        bytes32 salt;
    }

    function testFuzz_PercentageConstraint(uint256 yesPercent, address, bytes32) public pure {
        yesPercent = bound(yesPercent, 1, 9999);
        uint256 noPercent = BASIS_POINTS - yesPercent;

        assertEq(yesPercent + noPercent, BASIS_POINTS, "Must sum to 100%");
        assertTrue(yesPercent > 0, "YES must be > 0");
        assertTrue(noPercent > 0, "NO must be > 0");
    }

    function test_ComputeValidationHash() public pure {
        address agent = address(0x1234567890123456789012345678901234567890);
        uint256 yesPercent = 7000;
        uint256 noPercent = 3000;
        bytes32 salt = bytes32(uint256(0xdeadbeef));

        bytes32 hash = keccak256(abi.encodePacked(agent, yesPercent, noPercent, salt));

        bytes32 expected = keccak256(abi.encodePacked(
            address(0x1234567890123456789012345678901234567890),
            uint256(7000),
            uint256(3000),
            bytes32(uint256(0xdeadbeef))
        ));

        assertEq(hash, expected, "Validation hash mismatch");
    }

    function testFuzz_ComputeValidationHash(
        address agent,
        uint256 yesPercent,
        bytes32 salt
    ) public pure {
        yesPercent = bound(yesPercent, 1, 9999);
        uint256 noPercent = BASIS_POINTS - yesPercent;

        bytes32 hash1 = keccak256(abi.encodePacked(agent, yesPercent, noPercent, salt));
        bytes32 hash2 = keccak256(abi.encodePacked(agent, yesPercent, noPercent, salt));

        assertEq(hash1, hash2, "Hash should be deterministic");
    }

    function test_ValidationHashUniqueness() public pure {
        address agent = address(0x1234);
        uint256 yesPercent = 5000;
        uint256 noPercent = 5000;
        bytes32 salt1 = bytes32(uint256(1));
        bytes32 salt2 = bytes32(uint256(2));

        bytes32 hash1 = keccak256(abi.encodePacked(agent, yesPercent, noPercent, salt1));
        bytes32 hash2 = keccak256(abi.encodePacked(agent, yesPercent, noPercent, salt2));

        assertTrue(hash1 != hash2, "Different salts should produce different hashes");
    }

    function test_CalculateShares_YesWins() public pure {
        uint8 resolvedOutcome = 1;
        uint256 yesPercent = 9000;
        uint256 noPercent = 1000;
        uint256 ticketCost = 1e18;

        (uint256 yesShares, uint256 noShares) = _calculateShares(
            resolvedOutcome,
            yesPercent,
            noPercent,
            ticketCost
        );

        assertEq(yesShares, (ticketCost * yesPercent * PRECISION) / BASIS_POINTS, "YES shares wrong");
        assertEq(noShares, (ticketCost * (BASIS_POINTS - yesPercent) * PRECISION) / (BASIS_POINTS * 4), "NO shares wrong");
    }

    function test_CalculateShares_NoWins() public pure {
        uint8 resolvedOutcome = 2;
        uint256 yesPercent = 3000;
        uint256 noPercent = 7000;
        uint256 ticketCost = 1e18;

        (uint256 yesShares, uint256 noShares) = _calculateShares(
            resolvedOutcome,
            yesPercent,
            noPercent,
            ticketCost
        );

        assertEq(yesShares, (ticketCost * (BASIS_POINTS - noPercent) * PRECISION) / (BASIS_POINTS * 4), "YES shares wrong");
        assertEq(noShares, (ticketCost * noPercent * PRECISION) / BASIS_POINTS, "NO shares wrong");
    }

    function testFuzz_CalculateShares(
        uint8 resolvedOutcome,
        uint256 yesPercent,
        uint256 ticketCost
    ) public pure {
        vm.assume(resolvedOutcome == 1 || resolvedOutcome == 2);
        yesPercent = bound(yesPercent, 1, 9999);
        ticketCost = bound(ticketCost, 1, 1e24);

        uint256 noPercent = BASIS_POINTS - yesPercent;

        (uint256 yesShares, uint256 noShares) = _calculateShares(
            resolvedOutcome,
            yesPercent,
            noPercent,
            ticketCost
        );

        assertTrue(yesShares > 0, "YES shares must be > 0");
        assertTrue(noShares > 0, "NO shares must be > 0");
    }

    function _calculateShares(
        uint8 resolvedOutcome,
        uint256 yesPercent,
        uint256 noPercent,
        uint256 ticketCost
    ) internal pure returns (uint256 yesShares, uint256 noShares) {
        if (resolvedOutcome == 1) {
            yesShares = (ticketCost * yesPercent * PRECISION) / BASIS_POINTS;
            noShares = (ticketCost * (BASIS_POINTS - yesPercent) * PRECISION) / (BASIS_POINTS * 4);
        } else {
            noShares = (ticketCost * noPercent * PRECISION) / BASIS_POINTS;
            yesShares = (ticketCost * (BASIS_POINTS - noPercent) * PRECISION) / (BASIS_POINTS * 4);
        }
    }

    function test_MerkleLeafHash() public pure {
        address agent = address(0x1234567890123456789012345678901234567890);
        uint8 outcome = 1;
        uint256 yesShares = 9e17;
        uint256 noShares = 25e15;

        bytes32 leaf = keccak256(abi.encodePacked(agent, outcome, yesShares, noShares));

        bytes32 expected = keccak256(abi.encodePacked(
            address(0x1234567890123456789012345678901234567890),
            uint8(1),
            uint256(9e17),
            uint256(25e15)
        ));

        assertEq(leaf, expected, "Leaf hash mismatch");
    }

    function test_MerkleTree_SingleLeaf() public pure {
        bytes32 leaf = keccak256(abi.encodePacked(
            address(0x1234),
            uint8(1),
            uint256(1e18),
            uint256(1e17)
        ));

        bytes32 root = leaf;

        bytes32[] memory proof = new bytes32[](0);

        bool valid = MerkleProof.verify(proof, root, leaf);
        assertTrue(valid, "Single leaf should be valid");
    }

    function test_MerkleTree_TwoLeaves() public pure {
        bytes32 leaf0 = keccak256(abi.encodePacked(address(0x1111), uint8(1), uint256(1e18), uint256(1e17)));
        bytes32 leaf1 = keccak256(abi.encodePacked(address(0x2222), uint8(1), uint256(5e17), uint256(125e15)));

        bytes32 root = Hashes.commutativeKeccak256(leaf0, leaf1);

        bytes32[] memory proof0 = new bytes32[](1);
        proof0[0] = leaf1;

        bytes32[] memory proof1 = new bytes32[](1);
        proof1[0] = leaf0;

        assertTrue(MerkleProof.verify(proof0, root, leaf0), "Leaf 0 should be valid");
        assertTrue(MerkleProof.verify(proof1, root, leaf1), "Leaf 1 should be valid");
        assertFalse(MerkleProof.verify(proof0, root, leaf1), "Wrong proof for leaf1 should fail");
        assertFalse(MerkleProof.verify(proof1, root, leaf0), "Wrong proof for leaf0 should fail");
    }

    function test_MerkleTree_FourLeaves() public pure {
        bytes32 leaf0 = keccak256(abi.encodePacked(address(0x1), uint8(1), uint256(1e18), uint256(1e17)));
        bytes32 leaf1 = keccak256(abi.encodePacked(address(0x2), uint8(1), uint256(2e18), uint256(2e17)));
        bytes32 leaf2 = keccak256(abi.encodePacked(address(0x3), uint8(1), uint256(3e18), uint256(3e17)));
        bytes32 leaf3 = keccak256(abi.encodePacked(address(0x4), uint8(1), uint256(4e18), uint256(4e17)));

        bytes32 hash01 = Hashes.commutativeKeccak256(leaf0, leaf1);
        bytes32 hash23 = Hashes.commutativeKeccak256(leaf2, leaf3);

        bytes32 root = Hashes.commutativeKeccak256(hash01, hash23);

        bytes32[] memory proof0 = new bytes32[](2);
        proof0[0] = leaf1;
        proof0[1] = hash23;

        assertTrue(MerkleProof.verify(proof0, root, leaf0), "Leaf 0 should be valid");

        bytes32[] memory proof2 = new bytes32[](2);
        proof2[0] = leaf3;
        proof2[1] = hash01;

        assertTrue(MerkleProof.verify(proof2, root, leaf2), "Leaf 2 should be valid");

        bytes32[] memory proof3 = new bytes32[](2);
        proof3[0] = leaf2;
        proof3[1] = hash01;

        assertTrue(MerkleProof.verify(proof3, root, leaf3), "Leaf 3 should be valid");
    }

    function test_MerkleTree_EightLeaves() public pure {
        bytes32[] memory leaves = new bytes32[](8);
        for (uint256 i = 0; i < 8; i++) {
            leaves[i] = keccak256(abi.encodePacked(
                address(uint160(i + 1)),
                uint8(1),
                uint256((i + 1) * 1e17),
                uint256((i + 1) * 1e16)
            ));
        }

        bytes32[] memory level1 = new bytes32[](4);
        for (uint256 i = 0; i < 4; i++) {
            level1[i] = Hashes.commutativeKeccak256(leaves[2 * i], leaves[2 * i + 1]);
        }

        bytes32[] memory level2 = new bytes32[](2);
        level2[0] = Hashes.commutativeKeccak256(level1[0], level1[1]);
        level2[1] = Hashes.commutativeKeccak256(level1[2], level1[3]);

        bytes32 root = Hashes.commutativeKeccak256(level2[0], level2[1]);

        bytes32[] memory proof0 = new bytes32[](3);
        proof0[0] = leaves[1];
        proof0[1] = level1[1];
        proof0[2] = level2[1];
        assertTrue(MerkleProof.verify(proof0, root, leaves[0]), "Leaf 0 should be valid");

        bytes32[] memory proof7 = new bytes32[](3);
        proof7[0] = leaves[6];
        proof7[1] = level1[2];
        proof7[2] = level2[0];
        assertTrue(MerkleProof.verify(proof7, root, leaves[7]), "Leaf 7 should be valid");

        bytes32[] memory proof4 = new bytes32[](3);
        proof4[0] = leaves[5];
        proof4[1] = level1[3];
        proof4[2] = level2[0];
        assertTrue(MerkleProof.verify(proof4, root, leaves[4]), "Leaf 4 should be valid");
    }

    function test_MerkleTree_InvalidProof() public pure {
        bytes32 leaf0 = keccak256(abi.encodePacked(address(0x1), uint8(1), uint256(1e18), uint256(1e17)));
        bytes32 leaf1 = keccak256(abi.encodePacked(address(0x2), uint8(1), uint256(2e18), uint256(2e17)));

        bytes32 root = Hashes.commutativeKeccak256(leaf0, leaf1);

        bytes32 wrongLeaf = keccak256(abi.encodePacked(address(0xdead), uint8(1), uint256(1e18), uint256(1e17)));

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf1;

        assertFalse(MerkleProof.verify(proof, root, wrongLeaf), "Wrong leaf should fail");

        bytes32[] memory wrongProof = new bytes32[](1);
        wrongProof[0] = keccak256("wrong");
        assertFalse(MerkleProof.verify(wrongProof, root, leaf0), "Wrong proof should fail");
    }

    function test_EncryptedPayloadSize() public pure {
        address agent = address(0x1234567890123456789012345678901234567890);
        uint256 yesPercent = 7000;
        uint256 noPercent = 3000;
        bytes32 salt = bytes32(uint256(0xdeadbeef));

        bytes memory payload = abi.encodePacked(agent, yesPercent, noPercent, salt);

        assertEq(payload.length, 116, "Payload should be 116 bytes");
    }

    function test_EncryptedPayloadDecoding() public pure {
        address originalAgent = address(0x1234567890123456789012345678901234567890);
        uint256 originalYesPercent = 7000;
        uint256 originalNoPercent = 3000;
        bytes32 originalSalt = bytes32(uint256(0xdeadbeef));

        bytes memory payload = abi.encodePacked(
            originalAgent,
            originalYesPercent,
            originalNoPercent,
            originalSalt
        );

        address decodedAgent;
        uint256 decodedYesPercent;
        uint256 decodedNoPercent;
        bytes32 decodedSalt;

        assembly {
            let dataPtr := add(payload, 32)
            
            let firstWord := mload(dataPtr)
            decodedAgent := shr(96, firstWord)
            
            let secondWord := mload(add(dataPtr, 20))
            decodedYesPercent := shr(96, shl(96, secondWord))
            
            let thirdWord := mload(add(dataPtr, 52))
            decodedNoPercent := mload(add(dataPtr, 52))
            
            decodedSalt := mload(add(dataPtr, 84))
        }

        assertEq(decodedAgent, originalAgent, "Agent mismatch");
        assertEq(decodedYesPercent, originalYesPercent, "YES percent mismatch");
        assertEq(decodedNoPercent, originalNoPercent, "NO percent mismatch");
        assertEq(decodedSalt, originalSalt, "Salt mismatch");
    }

    function testFuzz_EncryptedPayloadRoundTrip(
        address agent,
        uint256 yesPercent,
        bytes32 salt
    ) public pure {
        vm.assume(agent != address(0));
        yesPercent = bound(yesPercent, 1, 9999);
        uint256 noPercent = BASIS_POINTS - yesPercent;

        bytes memory payload = abi.encodePacked(agent, yesPercent, noPercent, salt);

        assertEq(payload.length, 116, "Payload length mismatch");

        bytes20 agentBytes;
        uint256 decodedYes;
        uint256 decodedNo;
        bytes32 decodedSalt;

        assembly {
            let dataPtr := add(payload, 32)
            agentBytes := mload(dataPtr)
            decodedYes := mload(add(dataPtr, 20))
            decodedNo := mload(add(dataPtr, 52))
            decodedSalt := mload(add(dataPtr, 84))
        }

        assertEq(address(agentBytes), agent, "Agent mismatch");
        assertEq(decodedYes, yesPercent, "YES percent mismatch");
        assertEq(decodedNo, noPercent, "NO percent mismatch");
        assertEq(decodedSalt, salt, "Salt mismatch");
    }

    function test_ScoringAccuracy() public pure {
        uint256 ticketCost = 1e18;
        uint8 outcome = 1;

        uint256 strongYesShares;
        uint256 strongNoShares;
        (strongYesShares, strongNoShares) = _calculateShares(outcome, 9000, 1000, ticketCost);

        uint256 weakYesShares;
        uint256 weakNoShares;
        (weakYesShares, weakNoShares) = _calculateShares(outcome, 5100, 4900, ticketCost);

        assertTrue(strongYesShares > weakYesShares, "Strong YES should get more YES shares");
        assertTrue(strongNoShares < weakNoShares, "Weak YES prediction has more error, gets more NO shares");
    }

    function test_ScoringConsistency() public pure {
        uint256 ticketCost = 1e18;

        uint256 totalShares1;
        uint256 totalShares2;
        {
            (uint256 yes, uint256 no) = _calculateShares(1, 5000, 5000, ticketCost);
            totalShares1 = yes + no;
        }
        {
            (uint256 yes, uint256 no) = _calculateShares(2, 5000, 5000, ticketCost);
            totalShares2 = yes + no;
        }

        assertEq(totalShares1, totalShares2, "Same allocation should get same total regardless of outcome");
    }

    function test_MerkleProofGasCost() public {
        bytes32[] memory leaves = new bytes32[](8);
        for (uint256 i = 0; i < 8; i++) {
            leaves[i] = keccak256(abi.encodePacked(
                address(uint160(i + 1)),
                uint8(1),
                uint256((i + 1) * 1e17),
                uint256((i + 1) * 1e16)
            ));
        }

        bytes32[] memory level1 = new bytes32[](4);
        for (uint256 i = 0; i < 4; i++) {
            level1[i] = Hashes.commutativeKeccak256(leaves[2 * i], leaves[2 * i + 1]);
        }

        bytes32[] memory level2 = new bytes32[](2);
        level2[0] = Hashes.commutativeKeccak256(level1[0], level1[1]);
        level2[1] = Hashes.commutativeKeccak256(level1[2], level1[3]);

        bytes32 root = Hashes.commutativeKeccak256(level2[0], level2[1]);

        bytes32[] memory proof = new bytes32[](3);
        proof[0] = leaves[1];
        proof[1] = level1[1];
        proof[2] = level2[1];

        uint256 gasBefore = gasleft();
        bool valid = MerkleProof.verify(proof, root, leaves[0]);
        uint256 gasUsed = gasBefore - gasleft();

        assertTrue(valid, "Proof should be valid");
        emit log_named_uint("Gas used for merkle verification (8 leaves)", gasUsed);
    }
}

contract ScoringBenchmarkTest is Test {
    uint256 constant PRECISION = 1e18;
    uint256 constant BASIS_POINTS = 10000;

    function _calculateShares(
        uint8 resolvedOutcome,
        uint256 yesPercent,
        uint256 noPercent,
        uint256 ticketCost
    ) internal pure returns (uint256 yesShares, uint256 noShares) {
        if (resolvedOutcome == 1) {
            yesShares = (ticketCost * yesPercent * PRECISION) / BASIS_POINTS;
            noShares = (ticketCost * (BASIS_POINTS - yesPercent) * PRECISION) / (BASIS_POINTS * 4);
        } else {
            noShares = (ticketCost * noPercent * PRECISION) / BASIS_POINTS;
            yesShares = (ticketCost * (BASIS_POINTS - noPercent) * PRECISION) / (BASIS_POINTS * 4);
        }
    }

    function test_BenchmarkScoringDistribution() public view {
        uint256 ticketCost = 1e18;
        uint8 outcome = 1;

        uint256[5] memory yesPercents = [uint256(9000), 7500, 5000, 2500, 1000];

        for (uint256 i = 0; i < 5; i++) {
            uint256 yesPercent = yesPercents[i];
            uint256 noPercent = BASIS_POINTS - yesPercent;

            (uint256 yesShares, uint256 noShares) = _calculateShares(outcome, yesPercent, noPercent, ticketCost);

            console.log("=== YES Percent:", yesPercent / 100, "% ===");
            console.log("YES shares:", yesShares);
            console.log("NO shares:", noShares);
            console.log("Total shares:", yesShares + noShares);
        }
    }
}
