// merkle.ts - Merkle tree for Phase 1 share allocation

import { keccak256, encodePacked } from "viem";
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";

export interface MerkleLeaf {
  agent: `0x${string}`;
  yesShares: bigint;
  noShares: bigint;
}

export const computeLeafHash = (leaf: MerkleLeaf): `0x${string}` => {
  return keccak256(
    encodePacked(["address", "uint256", "uint256"], [leaf.agent, leaf.yesShares, leaf.noShares])
  );
};

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
  return {
    root: tree.root as `0x${string}`,
    leaves: leafHashes,
    getProof: (index: number) => tree.getProof(index) as `0x${string}`[],
  };
};

export interface MerkleLeafData {
  index: number;
  agent: `0x${string}`;
  yesShares: bigint;
  noShares: bigint;
  leafHash: `0x${string}`;
  proof: `0x${string}`[];
}
