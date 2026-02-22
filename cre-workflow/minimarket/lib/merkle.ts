// merkle.ts
// Merkle tree utilities for Info Reveal workflow.
// Compatible with the contract's non-commutative keccak256 hashing.

import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

export interface MerkleLeaf {
  agent: `0x${string}`;
  outcome: 1 | 2;
  yesShares: bigint;
  noShares: bigint;
}

export const computeLeafHash = (leaf: MerkleLeaf): `0x${string}` => {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, uint8, uint256, uint256"),
      [leaf.agent, leaf.outcome, leaf.yesShares, leaf.noShares]
    )
  );
};

const hashPair = (left: `0x${string}`, right: `0x${string}`): `0x${string}` => {
  const leftBytes = Buffer.from(left.slice(2), "hex");
  const rightBytes = Buffer.from(right.slice(2), "hex");
  return keccak256(Buffer.concat([leftBytes, rightBytes]));
};

export const buildMerkleTree = (
  leaves: MerkleLeaf[]
): {
  root: `0x${string}`;
  leaves: `0x${string}`[];
  getProof: (index: number) => `0x${string}`[];
} => {
  const leafHashes = leaves.map(computeLeafHash);

  if (leafHashes.length === 0) {
    return {
      root: "0x0000000000000000000000000000000000000000000000000000000000000000",
      leaves: [],
      getProof: () => [],
    };
  }

  if (leafHashes.length === 1) {
    return {
      root: leafHashes[0],
      leaves: leafHashes,
      getProof: () => [],
    };
  }

  let currentLevel = [...leafHashes];
  const tree: `0x${string}`[][] = [currentLevel];

  while (currentLevel.length > 1) {
    const nextLevel: `0x${string}`[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
      } else {
        nextLevel.push(currentLevel[i]);
      }
    }

    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  const root = currentLevel[0];

  const getProof = (index: number): `0x${string}`[] => {
    const proof: `0x${string}`[] = [];
    let currentIndex = index;

    for (let level = 0; level < tree.length - 1; level++) {
      const levelNodes = tree[level];
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;

      if (siblingIndex < levelNodes.length) {
        proof.push(levelNodes[siblingIndex]);
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
  };

  return { root, leaves: leafHashes, getProof };
};

export const verifyProof = (
  root: `0x${string}`,
  leaf: `0x${string}`,
  proof: `0x${string}`[],
  index: number
): boolean => {
  let hash = leaf;

  for (const proofElement of proof) {
    if (index % 2 === 0) {
      hash = hashPair(hash, proofElement);
    } else {
      hash = hashPair(proofElement, hash);
    }
    index = Math.floor(index / 2);
  }

  return hash === root;
};

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
  outcome: 1 | 2;
  yesShares: bigint;
  noShares: bigint;
  leafHash: `0x${string}`;
  proof: `0x${string}`[];
}
