// merkle.ts
// Merkle tree utilities for Info Reveal workflow.
// Uses OpenZeppelin SimpleMerkleTree (commutative hash) - compatible with OZ MerkleProof.verify on-chain.

import { keccak256, encodePacked } from "viem";
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";

/** Phase1 price discovery: agent gets yesShares + noShares based on consensus proximity (off-chain in CRE) */
export interface MerkleLeaf {
  agent: `0x${string}`;
  yesShares: bigint;
  noShares: bigint;
}

/** Matches contract: keccak256(abi.encodePacked(agent, yesShares, noShares)) */
export const computeLeafHash = (leaf: MerkleLeaf): `0x${string}` => {
  return keccak256(
    encodePacked(
      ["address", "uint256", "uint256"],
      [leaf.agent, leaf.yesShares, leaf.noShares]
    )
  );
};

/** Build tree using OpenZeppelin SimpleMerkleTree - compatible with OZ MerkleProof.verifyCalldata */
export const buildMerkleTree = (
  leaves: MerkleLeaf[]
): {
  root: `0x${string}`;
  leaves: `0x${string}`[];
  getProof: (index: number) => `0x${string}`[];
} => {
  if (leaves.length === 0) {
    return {
      root: "0x0000000000000000000000000000000000000000000000000000000000000000",
      leaves: [],
      getProof: () => [],
    };
  }

  const leafHashes = leaves.map(computeLeafHash);
  const tree = SimpleMerkleTree.of(leafHashes);

  const getProof = (index: number): `0x${string}`[] => {
    return tree.getProof(index) as `0x${string}`[];
  };

  return {
    root: tree.root as `0x${string}`,
    leaves: leafHashes,
    getProof,
  };
};

export const verifyProof = (
  root: `0x${string}`,
  leaf: `0x${string}`,
  proof: `0x${string}`[]
): boolean => {
  return SimpleMerkleTree.verify(root, leaf, proof);
};

/** Validation hash for encrypted payload: keccak256(agent, yesPercent, noPercent, salt) */
export const computeValidationHash = (
  agent: `0x${string}`,
  yesPercent: bigint,
  noPercent: bigint,
  salt: `0x${string}`
): `0x${string}` => {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, uint256, uint256, bytes32"),
      [agent, yesPercent, noPercent, salt]
    )
  );
};

export interface MerkleData {
  marketId: string;
  merkleRoot: `0x${string}`;
  resolvedOutcome: 1 | 2;
  leaves: MerkleLeafData[];
  totalYesShares: bigint;
  totalNoShares: bigint;
  timestamp: number;
  drandRound: bigint;
}

export interface MerkleLeafData {
  index: number;
  agent: `0x${string}`;
  yesShares: bigint;
  noShares: bigint;
  leafHash: `0x${string}`;
  proof: `0x${string}`[];
}
