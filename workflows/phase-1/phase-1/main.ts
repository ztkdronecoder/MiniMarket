// Phase 1: Encrypted Infomarket - Cron workflow
// Decrypts submissions via drand, builds merkle tree, posts revealInfoPhase onchain

import {
  cre,
  handler,
  Runner,
  getNetwork,
  hexToBase64,
  bytesToHex,
  TxStatus,
} from "@chainlink/cre-sdk";
import { CronCapability, type Runtime } from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters, keccak256 } from "viem";
import { configSchema, type Config, type DecryptedSubmission } from "./types";
import { fetchBeacon, canDecrypt, decryptSubmission, verifySubmission } from "./lib/drand";
import { buildMerkleTree } from "./lib/merkle";
import { fetchPhase1PendingMarkets } from "./lib/ponder";
import { fetchSubmissionsFromContract } from "./lib/contract";
import { uploadLeafesToPinata, type MerkleLeaf } from "./lib/pinata";

/** Deterministic submarketId = keccak256(abi.encode(parentMarketId, optionIndex)) — matches contract getSubmarketId */
function getSubmarketId(parentMarketId: bigint, optionIndex: number): `0x${string}` {
  return keccak256(encodeAbiParameters(parseAbiParameters("uint256, uint256"), [parentMarketId, BigInt(optionIndex)]));
}

const onCronTrigger = async (runtime: Runtime<Config>): Promise<string> => {
  runtime.log("Phase 1 cron triggered");

  const pending = fetchPhase1PendingMarkets(runtime);
  if (pending.length === 0) {
    runtime.log("No phase1 markets to decrypt");
    return "NO_PENDING";
  }

  const market = pending[0];
  const marketId = BigInt(market.marketId);
  const targetRound = BigInt(market.drandTargetRound);
  const network = runtime.config.drandNetwork;
  const evmConfig = runtime.config.evms[0];

  if (!canDecrypt(targetRound, network)) {
    runtime.log(`Market ${marketId}: drand round ${targetRound} not yet reached`);
    return "SKIPPED_NOT_YET";
  }

  try {
    let beacon;
    try {
      beacon = fetchBeacon(runtime, targetRound, network);
      runtime.log(`Beacon fetched for round ${targetRound}`);
    } catch (beaconError) {
      runtime.log(`Failed to fetch drand beacon: ${beaconError}`);
      return "SKIPPED_BEACON_FAILED";
    }

    // Prefer ciphertexts already indexed by ponder (included in next-phase1 response).
    // Fall back to a direct RPC batch call if ponder doesn't have them.
    let submissions = (market.submissions ?? [])
      .filter((s) => s.ciphertext && s.ciphertext.length > 2)
      .map((s) => ({
        agent: s.agent as `0x${string}`,
        ciphertext: s.ciphertext as `0x${string}`,
        validationHash: s.validationHash as `0x${string}`,
      }));

    if (submissions.length === 0) {
      runtime.log(`Market ${marketId}: ponder has no ciphertexts, fetching from contract RPC`);
      submissions = fetchSubmissionsFromContract(runtime, marketId, evmConfig.marketAddress);
    }

    if (submissions.length === 0) {
      runtime.log(`Market ${marketId}: no submissions found`);
      return "SKIPPED_NO_SUBMISSIONS";
    }
    runtime.log(`Market ${marketId}: ${submissions.length} submission(s) to decrypt`);

    const decrypted: DecryptedSubmission[] = [];
    for (const sub of submissions) {
      let yesPercent = 500n;
      let noPercent = 500n;
      let isValid = false;
      let options: Array<{ index: number; yesPercent: bigint; noPercent: bigint }> | undefined;

      try {
        const decryptedData = await decryptSubmission(sub.ciphertext, beacon, network);
        yesPercent = decryptedData.yesPercent;
        noPercent = decryptedData.noPercent;
        if (yesPercent + noPercent !== 1000n) {
          yesPercent = 500n;
          noPercent = 500n;
        }
        options = decryptedData.options;
        isValid = verifySubmission(
          { agent: decryptedData.agent, yesPercent, noPercent, salt: decryptedData.salt },
          sub.validationHash
        );
      } catch (error) {
        runtime.log(`Failed to decrypt from ${sub.agent}: ${error}`);
      }

      decrypted.push({
        agent: sub.agent,
        yesPercent,
        noPercent,
        salt: "",
        validationHash: sub.validationHash,
        isConsensus: isValid,
        yesShares: 0n,
        noShares: 0n,
        options,
      });
    }

    const optionCount = Math.max(1, market.optionCount ?? 1);
    runtime.log(`Market ${marketId}: ${optionCount} submarket(s) to reveal`);

    const PRECISION = BigInt(10 ** 18);

    // Per-submarket data for selector 2 (batch) report
    const smIds: `0x${string}`[] = [];
    const roots: `0x${string}`[] = [];
    const consensusOutcomes: (1 | 2)[] = [];
    const rYes: bigint[] = [];
    const rNo: bigint[] = [];
    const valids: bigint[] = [];
    const yShares: bigint[] = [];
    const nShares: bigint[] = [];
    const submarketLeavesForPinata: Array<{ index: number; leaves: MerkleLeaf[] }> = [];

    for (let optIdx = 0; optIdx < optionCount; optIdx++) {
      // Per-option predictions: use options[optIdx] for multi-option, else top-level yesPercent
      const perSubmarket = decrypted.map((d) => {
        const opt = d.options?.find((o) => o.index === optIdx) ?? d.options?.[optIdx];
        const yp = opt ? opt.yesPercent : d.yesPercent;
        const np = opt ? opt.noPercent : d.noPercent;
        return { ...d, yesPercent: yp, noPercent: np };
      });

      const totalYes = perSubmarket.reduce((s, x) => s + x.yesPercent, 0n);
      const consensusYesPercent = totalYes / BigInt(perSubmarket.length);
      const consensusNoPercent = 1000n - consensusYesPercent;
      const consensusOutcome: 1 | 2 = consensusYesPercent >= 500n ? 1 : 2;

      const K = BigInt(perSubmarket.length) * PRECISION;
      const totalReserve = 2n * K;

      const scores = perSubmarket.map((s) => {
        const dist =
          s.yesPercent >= consensusYesPercent
            ? s.yesPercent - consensusYesPercent
            : consensusYesPercent - s.yesPercent;
        return 1000n - dist;
      });
      const weights = scores.map((sc) => sc * sc);
      const totalWeight = weights.reduce((a, b) => a + b, 0n);

      for (let i = 0; i < perSubmarket.length; i++) {
        const sub = perSubmarket[i];
        const shareOfPool =
          totalWeight > 0n ? (totalReserve * weights[i]) / totalWeight : totalReserve / BigInt(perSubmarket.length);
        sub.yesShares = (shareOfPool * sub.yesPercent) / 1000n;
        sub.noShares = (shareOfPool * sub.noPercent) / 1000n;
      }

      const totalReserveYes = (totalReserve * consensusYesPercent) / 1000n;
      const totalReserveNo = (totalReserve * consensusNoPercent) / 1000n;
      const totalYesShares = perSubmarket.reduce((s, x) => s + x.yesShares, 0n);
      const totalNoShares = perSubmarket.reduce((s, x) => s + x.noShares, 0n);

      const { root: merkleRoot } = buildMerkleTree(
        perSubmarket.map((s) => ({ agent: s.agent, yesShares: s.yesShares, noShares: s.noShares }))
      );

      smIds.push(getSubmarketId(marketId, optIdx));
      roots.push(merkleRoot);
      consensusOutcomes.push(consensusOutcome);
      rYes.push(totalReserveYes);
      rNo.push(totalReserveNo);
      valids.push(BigInt(perSubmarket.length));
      yShares.push(totalYesShares);
      nShares.push(totalNoShares);
      submarketLeavesForPinata.push({
        index: optIdx,
        leaves: perSubmarket.map((s) => ({
          agent: s.agent,
          yesShares: s.yesShares.toString(),
          noShares: s.noShares.toString(),
          yesPercent: s.yesPercent.toString(),
          noPercent: s.noPercent.toString(),
          validationHash: s.validationHash,
        })),
      });

      runtime.log(`  Submarket ${optIdx}: consensus=${consensusOutcome === 1 ? "YES" : "NO"}`);
    }

    // Upload merkle leaves to IPFS via Pinata (HTTP call 4/5)
    let leavesURI = "";
    try {
      const pinataJwt = runtime.getSecret({ id: "PINATA_JWT", namespace: "PINATA_JWT_ALL" }).result().value;
      const leaves: MerkleLeaf[] = submarketLeavesForPinata[0]?.leaves ?? [];
      const cid = uploadLeafesToPinata(
        runtime,
        marketId,
        leaves,
        pinataJwt,
        optionCount > 1 ? submarketLeavesForPinata : undefined
      );
      if (cid) {
        leavesURI = `ipfs://${cid}`;
        runtime.log(`Leaves uploaded: ${leavesURI}`);
      } else {
        runtime.log("Pinata upload returned empty CID, proceeding without leavesURI");
      }
    } catch (secretErr) {
      runtime.log(`Could not fetch Pinata secret: ${secretErr}`);
    }

    // Report format: selector 2 = batch phase1 reveal (all submarkets in one tx)
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint8, bytes32[], bytes32[], uint8[], uint128[], uint128[], uint256[], uint128[], uint128[], string"),
      [
        2, // selector: batch phase1 reveal
        smIds,
        roots,
        consensusOutcomes,
        rYes,
        rNo,
        valids,
        yShares,
        nShares,
        leavesURI,
      ]
    );

    const reportResponse = runtime
      .report({
        encodedPayload: hexToBase64(reportData),
        encoderName: "evm",
        signingAlgo: "ecdsa",
        hashingAlgo: "keccak256",
      })
      .result();

    const networkInfo = getNetwork({
      chainFamily: "evm",
      chainSelectorName: evmConfig.chainSelectorName,
      isTestnet: true,
    });
    if (!networkInfo) {
      runtime.log("Network not found, skipping writeReport");
      return "COMPUTED_NO_NETWORK";
    }

    const evmClient = new cre.capabilities.EVMClient(networkInfo.chainSelector.selector);
    const writeResult = evmClient
      .writeReport(runtime, {
        receiver: evmConfig.marketAddress as `0x${string}`,
        report: reportResponse,
        gasConfig: { gasLimit: evmConfig.gasLimit },
      })
      .result();

    if (writeResult.txStatus === TxStatus.SUCCESS) {
      const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
      runtime.log(`Reveal submitted: ${txHash}`);
      return `REVEALED_${txHash}`;
    }

    runtime.log(`Write failed: ${writeResult.txStatus}`);
    return `FAILED_${writeResult.txStatus}`;
  } catch (error) {
    runtime.log(`Error: ${error}`);
    throw error;
  }
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [
    handler(
      cron.trigger({ schedule: config.schedule }),
      onCronTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
