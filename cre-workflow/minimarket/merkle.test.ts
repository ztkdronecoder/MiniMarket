import { describe, it, expect } from "vitest";
import {
  computeLeafHash,
  buildMerkleTree,
  verifyProof,
  computeValidationHash,
  type MerkleLeaf,
} from "./lib/merkle";

describe("Merkle Utilities", () => {
  describe("computeLeafHash", () => {
    it("should compute consistent leaf hash", () => {
      const leaf: MerkleLeaf = {
        agent: "0x1234567890123456789012345678901234567890",
        yesShares: BigInt("900000000000000000"),
        noShares: BigInt("25000000000000000"),
      };

      const hash1 = computeLeafHash(leaf);
      const hash2 = computeLeafHash(leaf);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it("should produce different hashes for different leaves", () => {
      const leaf1: MerkleLeaf = {
        agent: "0x1111111111111111111111111111111111111111",
        yesShares: BigInt("1000000000000000000"),
        noShares: BigInt("100000000000000000"),
      };

      const leaf2: MerkleLeaf = {
        agent: "0x2222222222222222222222222222222222222222",
        yesShares: BigInt("1000000000000000000"),
        noShares: BigInt("100000000000000000"),
      };

      expect(computeLeafHash(leaf1)).not.toBe(computeLeafHash(leaf2));
    });
  });

  describe("buildMerkleTree", () => {
    it("should build tree with single leaf", () => {
      const leaves: MerkleLeaf[] = [
        {
          agent: "0x1234567890123456789012345678901234567890",
          yesShares: BigInt("1000000000000000000"),
          noShares: BigInt("100000000000000000"),
        },
      ];

      const { root, leaves: leafHashes, getProof } = buildMerkleTree(leaves);

      expect(root).toMatch(/^0x[a-f0-9]{64}$/);
      expect(leafHashes.length).toBe(1);
      expect(leafHashes[0]).toBe(computeLeafHash(leaves[0]));

      const proof = getProof(0);
      expect(proof.length).toBe(0);

      expect(verifyProof(root, leafHashes[0], proof)).toBe(true);
    });

    it("should build tree with two leaves and generate valid proofs", () => {
      const leaves: MerkleLeaf[] = [
        {
          agent: "0x1111111111111111111111111111111111111111",
          yesShares: BigInt("1000000000000000000"),
          noShares: BigInt("100000000000000000"),
        },
        {
          agent: "0x2222222222222222222222222222222222222222",
          yesShares: BigInt("500000000000000000"),
          noShares: BigInt("125000000000000000"),
        },
      ];

      const { root, leaves: leafHashes, getProof } = buildMerkleTree(leaves);

      const proof0 = getProof(0);
      const proof1 = getProof(1);

      expect(proof0.length).toBe(1);
      expect(proof1.length).toBe(1);

      expect(verifyProof(root, leafHashes[0], proof0)).toBe(true);
      expect(verifyProof(root, leafHashes[1], proof1)).toBe(true);
    });

    it("should build tree with four leaves", () => {
      const leaves: MerkleLeaf[] = [];
      for (let i = 0; i < 4; i++) {
        leaves.push({
          agent: `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
          yesShares: BigInt((i + 1) * 10 ** 17),
          noShares: BigInt((i + 1) * 10 ** 16),
        });
      }

      const { root, leaves: leafHashes, getProof } = buildMerkleTree(leaves);

      expect(root).toMatch(/^0x[a-f0-9]{64}$/);

      for (let i = 0; i < 4; i++) {
        const proof = getProof(i);
        expect(verifyProof(root, leafHashes[i], proof)).toBe(true);
      }
    });

    it("should build tree with eight leaves", () => {
      const leaves: MerkleLeaf[] = [];
      for (let i = 0; i < 8; i++) {
        leaves.push({
          agent: `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
          yesShares: BigInt((i + 1) * 10 ** 17),
          noShares: BigInt((i + 1) * 10 ** 16),
        });
      }

      const { root, leaves: leafHashes, getProof } = buildMerkleTree(leaves);

      expect(root).toMatch(/^0x[a-f0-9]{64}$/);

      for (let i = 0; i < 8; i++) {
        const proof = getProof(i);
        expect(verifyProof(root, leafHashes[i], proof)).toBe(true);
      }
    });

    it("should return zero root for empty leaves", () => {
      const { root, leaves } = buildMerkleTree([]);

      expect(root).toBe("0x0000000000000000000000000000000000000000000000000000000000000000");
      expect(leaves.length).toBe(0);
    });
  });

  describe("verifyProof", () => {
    it("should reject invalid proof", () => {
      const leaves: MerkleLeaf[] = [
        {
          agent: "0x1111111111111111111111111111111111111111",
          yesShares: BigInt("1000000000000000000"),
          noShares: BigInt("100000000000000000"),
        },
        {
          agent: "0x2222222222222222222222222222222222222222",
          yesShares: BigInt("500000000000000000"),
          noShares: BigInt("125000000000000000"),
        },
      ];

      const { root, getProof } = buildMerkleTree(leaves);

      const wrongLeaf: MerkleLeaf = {
        agent: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
        yesShares: BigInt("1000000000000000000"),
        noShares: BigInt("100000000000000000"),
      };
      const wrongLeafHash = computeLeafHash(wrongLeaf);
      const proof = getProof(0);

      expect(verifyProof(root, wrongLeafHash, proof)).toBe(false);
    });

    it("should reject wrong index", () => {
      const leaves: MerkleLeaf[] = [
        {
          agent: "0x1111111111111111111111111111111111111111",
          yesShares: BigInt("1000000000000000000"),
          noShares: BigInt("100000000000000000"),
        },
        {
          agent: "0x2222222222222222222222222222222222222222",
          yesShares: BigInt("500000000000000000"),
          noShares: BigInt("125000000000000000"),
        },
      ];

      const { root, leaves: leafHashes, getProof } = buildMerkleTree(leaves);

      const proof1 = getProof(1);

      expect(verifyProof(root, leafHashes[0], proof1)).toBe(false);
    });

    it("should reject proof from different tree", () => {
      const leaves1: MerkleLeaf[] = [
        {
          agent: "0x1111111111111111111111111111111111111111",
          yesShares: BigInt("1000000000000000000"),
          noShares: BigInt("100000000000000000"),
        },
        {
          agent: "0x2222222222222222222222222222222222222222",
          yesShares: BigInt("500000000000000000"),
          noShares: BigInt("125000000000000000"),
        },
      ];

      const leaves2: MerkleLeaf[] = [
        {
          agent: "0x3333333333333333333333333333333333333333",
          yesShares: BigInt("1000000000000000000"),
          noShares: BigInt("100000000000000000"),
        },
        {
          agent: "0x4444444444444444444444444444444444444444",
          yesShares: BigInt("500000000000000000"),
          noShares: BigInt("125000000000000000"),
        },
      ];

      const tree1 = buildMerkleTree(leaves1);
      const tree2 = buildMerkleTree(leaves2);

      const proof1 = tree1.getProof(0);

      expect(verifyProof(tree2.root, tree1.leaves[0], proof1)).toBe(false);
    });
  });

  describe("computeValidationHash", () => {
    it("should compute deterministic hash", () => {
      const agent = "0x1234567890123456789012345678901234567890" as `0x${string}`;
      const yesPercent = BigInt(700);  // 70%
      const noPercent = BigInt(300);   // 30%
      const salt = "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as `0x${string}`;

      const hash1 = computeValidationHash(agent, yesPercent, noPercent, salt);
      const hash2 = computeValidationHash(agent, yesPercent, noPercent, salt);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it("should produce different hashes for different salts", () => {
      const agent = "0x1234567890123456789012345678901234567890" as `0x${string}`;
      const yesPercent = BigInt(500);
      const noPercent = BigInt(500);
      const salt1 = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;
      const salt2 = "0x0000000000000000000000000000000000000000000000000000000000000002" as `0x${string}`;

      const hash1 = computeValidationHash(agent, yesPercent, noPercent, salt1);
      const hash2 = computeValidationHash(agent, yesPercent, noPercent, salt2);

      expect(hash1).not.toBe(hash2);
    });

    it("should produce different hashes for different percentages", () => {
      const agent = "0x1234567890123456789012345678901234567890" as `0x${string}`;
      const salt = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;

      const hash1 = computeValidationHash(agent, BigInt(700), BigInt(300), salt);
      const hash2 = computeValidationHash(agent, BigInt(500), BigInt(500), salt);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("cross-validation with contract", () => {
    it("should match contract merkle tree for two leaves", () => {
      const leaf0: MerkleLeaf = {
        agent: "0x1111111111111111111111111111111111111111",
        yesShares: BigInt("1000000000000000000"),
        noShares: BigInt("100000000000000000"),
      };

      const leaf1: MerkleLeaf = {
        agent: "0x2222222222222222222222222222222222222222",
        yesShares: BigInt("500000000000000000"),
        noShares: BigInt("125000000000000000"),
      };

      const { root, leaves: leafHashes, getProof } = buildMerkleTree([leaf0, leaf1]);

      const proof0 = getProof(0);
      const proof1 = getProof(1);

      expect(verifyProof(root, leafHashes[0], proof0)).toBe(true);
      expect(verifyProof(root, leafHashes[1], proof1)).toBe(true);

      expect(verifyProof(root, leafHashes[0], proof1)).toBe(false);
      expect(verifyProof(root, leafHashes[1], proof0)).toBe(false);
    });
  });
});
