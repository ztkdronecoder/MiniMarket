// merkle.ts
// Merkle tree utilities for Info Reveal workflow.

import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import type { DecryptedSubmission } from "../types";

export const computeLeaf = (submission: DecryptedSubmission): `0x${string}` => {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, uint8, uint256"),
      [submission.agent, submission.outcome, submission.allocatedShares]
    )
  );
};

export const computeMerkleRoot = (leaves: `0x${string}`[]): `0x${string}` => {
  if (leaves.length === 0) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }

  if (leaves.length === 1) {
    return leaves[0];
  }

  let currentLevel = [...leaves];

  while (currentLevel.length > 1) {
    const nextLevel: `0x${string}`[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const combined = Buffer.concat([
          Buffer.from(currentLevel[i].slice(2), "hex"),
          Buffer.from(currentLevel[i + 1].slice(2), "hex"),
        ]);
        nextLevel.push(keccak256(combined));
      } else {
        nextLevel.push(currentLevel[i]);
      }
    }

    currentLevel = nextLevel;
  }

  return currentLevel[0];
};

export const buildMerkleTree = (
  submissions: DecryptedSubmission[]
): { root: `0x${string}`; leaves: `0x${string}`[] } => {
  const leaves = submissions.map(computeLeaf);
  const root = computeMerkleRoot(leaves);
  return { root, leaves };
};
