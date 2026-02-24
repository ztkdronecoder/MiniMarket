#!/usr/bin/env bun
/**
 * Build merkle tree from allocations JSON.
 * Run from cre-workflow: bun run scripts/build-merkle-from-json.ts <allocations.json>
 */

import { readFileSync } from "fs";
import { keccak256, encodePacked } from "viem";
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";

interface Allocation {
  agent: string;
  yesShares: string;
  noShares: string;
  yesPercent?: number;
  noPercent?: number;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: bun run scripts/build-merkle-from-json.ts <allocations.json>");
    process.exit(1);
  }

  const raw = readFileSync(path, "utf-8");
  let allocations: Allocation[];
  try {
    allocations = JSON.parse(raw);
  } catch {
    console.error("Invalid JSON");
    process.exit(1);
  }

  if (!Array.isArray(allocations) || allocations.length === 0) {
    console.error("Allocations must be a non-empty array");
    process.exit(1);
  }

  const leafHashes = allocations.map((a) =>
    keccak256(
      encodePacked(
        ["address", "uint256", "uint256"],
        [a.agent as `0x${string}`, BigInt(a.yesShares), BigInt(a.noShares)]
      )
    )
  );
  const tree = SimpleMerkleTree.of(leafHashes);
  const root = tree.root;

  let consensusYesPercent = 500n;
  if (allocations[0].yesPercent !== undefined) {
    const total = allocations.reduce((s, a) => s + BigInt(a.yesPercent ?? 500), 0n);
    consensusYesPercent = total / BigInt(allocations.length);
  } else {
    const totalYes = allocations.reduce((s, a) => s + BigInt(a.yesShares), 0n);
    const totalNo = allocations.reduce((s, a) => s + BigInt(a.noShares), 0n);
    const total = totalYes + totalNo;
    consensusYesPercent = total > 0n ? (totalYes * 1000n) / total : 500n;
  }
  const consensusOutcome = consensusYesPercent >= 500n ? 1 : 2;

  const totalReserveYes = allocations.reduce((s, a) => s + BigInt(a.yesShares), 0n);
  const totalReserveNo = allocations.reduce((s, a) => s + BigInt(a.noShares), 0n);

  const output = {
    merkleRoot: root,
    consensusOutcome,
    totalReserveYes: totalReserveYes.toString(),
    totalReserveNo: totalReserveNo.toString(),
    validSubmissions: allocations.length.toString(),
  };

  console.log(JSON.stringify(output));
}

main();
