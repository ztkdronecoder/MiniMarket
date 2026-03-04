'use client';

/**
 * Create Market Wizard — simulates the sepolia-demo flow in the browser.
 * Step 1: Create market
 * Step 2: Deploy/select fake agents via factory
 * Step 3: Fund agents with USDC
 * Step 4: Cast encrypted votes (randomized yes/no per agent)
 */
import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useWriteContract, useReadContracts, useConfig } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';
import { encodeFunctionData, parseEventLogs } from 'viem';
import {
  encryptPredictionBasisPoints,
  computeValidationHashBasisPoints,
  ciphertextToHex,
  currentRound,
  DRAND_QUICKNET,
} from '@/lib/drand';

const DRAND_CHAIN_HASH = '0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971' as `0x${string}`;
const DRAND_GENESIS = 1692803367;
const DRAND_PERIOD = 3;
const AGENT_INDICES = [0, 1, 2, 3, 4];
const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'getAgentAddress',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'deployAgents',
    inputs: [{ name: 'indices', type: 'uint256[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'batchFundAgents',
    inputs: [
      { name: 'indices', type: 'uint256[]' },
      { name: 'token', type: 'address' },
      { name: 'amountEach', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'execute',
    inputs: [
      { name: 'index', type: 'uint256' },
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'batchExecuteSame',
    inputs: [
      { name: 'indices', type: 'uint256[]' },
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes[]' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'batchExecute',
    inputs: [
      { name: 'indices', type: 'uint256[]' },
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes[]' },
    ],
    outputs: [{ type: 'bytes[]' }],
    stateMutability: 'nonpayable',
  },
] as const;

const MARKET_ABI = [
  {
    type: 'function',
    name: 'createSubmarket',
    inputs: [
      { name: 'parentMarketId', type: 'uint256' },
      { name: 'optionIndex', type: 'uint256' },
      { name: 'optionLabel', type: 'string' },
    ],
    outputs: [{ name: 'submarketId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createMarket',
    inputs: [
      { name: 'question', type: 'string' },
      { name: 'schemaJson', type: 'string' },
      { name: 'maxSlots', type: 'uint256' },
      { name: 'ticketCost', type: 'uint256' },
      { name: 'creatorOffer', type: 'uint256' },
      { name: 'drandTargetRound', type: 'uint64' },
      { name: 'drandChainHash', type: 'bytes32' },
      { name: 'tradingDuration', type: 'uint48' },
      { name: 'optionCount', type: 'uint256' },
    ],
    outputs: [{ name: 'marketId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'MarketCreated',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'question', type: 'string', indexed: false },
      { name: 'schemaJson', type: 'string', indexed: false },
      { name: 'maxSlots', type: 'uint256', indexed: false },
      { name: 'ticketCost', type: 'uint256', indexed: false },
      { name: 'drandTargetRound', type: 'uint64', indexed: false },
      { name: 'creatorOffer', type: 'uint256', indexed: false },
      { name: 'optionCount', type: 'uint256', indexed: false },
    ],
  },
] as const;

type Step = 1 | 2 | 'done';

function randomYesPercent(): number {
  // Random 0-1000 (basis points), avoid exactly 500 for variety
  const v = Math.floor(Math.random() * 1001);
  return v === 500 ? (Math.random() > 0.5 ? 501 : 499) : v;
}

export function CreateMarketWizard() {
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const marketAddress = process.env.NEXT_PUBLIC_MARKET_ADDRESS as `0x${string}` | undefined;
  const factoryAddress = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as `0x${string}` | undefined;
  const usdcAddress = process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}` | undefined;

  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  // Step 1 state
  const [question, setQuestion] = useState('');
  const [maxSlots, setMaxSlots] = useState('5');
  const [ticketCost, setTicketCost] = useState('0.00001');
  const [creatorOffer, setCreatorOffer] = useState('0');
  const [phase1EndMinutes, setPhase1EndMinutes] = useState('3');
  const [phase2EndMinutes, setPhase2EndMinutes] = useState('5');
  const [optionCount, setOptionCount] = useState('1');
  const [optionLabels, setOptionLabels] = useState<string[]>(['']);
  const [marketId, setMarketId] = useState<string | null>(null);

  // Step 2 state
  const [selectedAgents, setSelectedAgents] = useState<number[]>([0]);
  const [agentAddresses, setAgentAddresses] = useState<string[]>([]);

  const ticketCostRaw = BigInt(Math.round(Number(ticketCost) * 1e6));
  const creatorOfferRaw = BigInt(Math.round(Number(creatorOffer) * 1e6));
  const maxSlotsVal = BigInt(maxSlots);
  const optionCountVal = BigInt(Math.max(parseInt(optionCount, 10) || 1, 1));
  const totalDeposit =
    maxSlotsVal * ticketCostRaw + creatorOfferRaw * optionCountVal;
  // ticketCost per submarket: agents pay ticketCost × optionCount
  const fundPerAgent = ticketCostRaw * optionCountVal;
  const totalFund = fundPerAgent * BigInt(selectedAgents.length);

  const p1 = Math.max(1, Math.round(Number(phase1EndMinutes)));
  const p2 = Math.max(p1 + 1, Math.round(Number(phase2EndMinutes)));
  const tradingDurationSec = p2 * 60;
  const drandTargetRound = currentRound(DRAND_QUICKNET) + BigInt(Math.round(p1 * 60 / DRAND_QUICKNET.period));

  // Fetch agent addresses (only when factory is set)
  const { data: addrsResult } = useReadContracts({
    contracts: factoryAddress
      ? AGENT_INDICES.map((i) => ({
          address: factoryAddress,
          abi: FACTORY_ABI,
          functionName: 'getAgentAddress' as const,
          args: [BigInt(i)] as const,
        }))
      : [],
  });
  const addrs: (string | undefined)[] = (addrsResult ?? []).map((r) =>
    r.status === 'success' ? (r.result as string) : undefined
  );

  const canProceed =
    marketAddress &&
    factoryAddress &&
    usdcAddress;

  const runTx = useCallback(
    async (tx: () => Promise<`0x${string}`>, label: string) => {
      setProgress(label);
      const hash = await tx();
      await waitForTransactionReceipt(config, { hash });
      await new Promise((r) => setTimeout(r, 1500));
    },
    [config]
  );

  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!marketAddress || !usdcAddress) {
      setError('NEXT_PUBLIC_MARKET_ADDRESS or USDC not set');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const optCount = Math.max(1, parseInt(optionCount, 10) || 1);
      const optionsJson = Array.from({ length: optCount }, (_, i) => ({
        index: i,
        label: (optionLabels[i] ?? '').trim() || (optCount === 1 ? question : `Option ${i + 1}`),
      }));
      const schemaJson = JSON.stringify({
        version: '1.0',
        label: 'other',
        description: question,
        deadline: Math.floor(Date.now() / 1000) + tradingDurationSec + 120,
        options: optionsJson,
        resolution: {
          method: 'ai',
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          prompt: question,
          grounding: 'google_search',
        },
      });

      await runTx(
        () =>
          writeContractAsync({
            address: usdcAddress,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [marketAddress, totalDeposit],
          }),
        'Approve USDC…'
      );

      const createTx = await writeContractAsync({
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: 'createMarket',
        args: [
          question,
          schemaJson,
          maxSlotsVal,
          ticketCostRaw,
          creatorOfferRaw,
          drandTargetRound,
          DRAND_CHAIN_HASH,
          BigInt(tradingDurationSec),
          optionCountVal,
        ],
      });
      setProgress('Create market…');
      const receipt = await waitForTransactionReceipt(config, { hash: createTx });
      const logs = parseEventLogs({
        abi: MARKET_ABI,
        logs: receipt.logs,
        eventName: 'MarketCreated',
      });
      const newMarketId = logs[0]?.args?.marketId ?? 1n;
      // createMarket auto-creates all submarkets; option labels are in schemaJson (indexer uses that)
      setMarketId(newMarketId.toString());
      setStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  /**
   * Deploy agents + fund + cast votes.
   * Uses only the original `execute` function (no batch variants needed),
   * so it works with any version of FakeAgentFactory.
   *
   * TX count: 3 setup + 2×N agent txs  (e.g. 5 txs for 1 agent, 13 txs for 5 agents)
   */
  const handleStep2 = async () => {
    if (!factoryAddress || !marketAddress || !usdcAddress || !marketId) return;
    setError('');
    setBusy(true);
    try {
      const approveFragment = {
        type: 'function' as const,
        name: 'approve',
        inputs: [
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ type: 'bool' }],
        stateMutability: 'nonpayable',
      };
      const submitFragment = {
        type: 'function' as const,
        name: 'submitEncrypted',
        inputs: [
          { name: 'marketId', type: 'uint256' },
          { name: 'ciphertext', type: 'bytes' },
          { name: 'validationHash', type: 'bytes32' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      };

      const N = selectedAgents.length;
      const totalTxs = 3 + N * 2;

      setProgress('Encrypting votes…');
      const agentIndices = selectedAgents.map(BigInt);
      const agentAddrs = selectedAgents.map((i) => (addrs[i] as string) ?? `0x${'0'.repeat(40)}`);
      const optCount = Number(optionCountVal);

      // Pre-encrypt all votes before sending any transactions
      const predictions = await Promise.all(
        selectedAgents.map(async (_agentIndex, i) => {
          const agentAddr = agentAddrs[i];
          const yesPercent = randomYesPercent();
          const salt = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          const options =
            optCount > 1
              ? Array.from({ length: optCount }, (_, j) => ({
                  index: j,
                  yesPercent,
                  noPercent: 1000 - yesPercent,
                }))
              : undefined;
          const prediction = {
            yesPercent,
            noPercent: 1000 - yesPercent,
            agent: agentAddr,
            salt,
            ...(options ? { options } : {}),
          };
          const encrypted = await encryptPredictionBasisPoints(prediction, drandTargetRound, DRAND_QUICKNET);
          const ciphertext = ciphertextToHex(encrypted.ciphertext);
          const validationHash = computeValidationHashBasisPoints(prediction);
          const submitData = encodeFunctionData({
            abi: [submitFragment],
            functionName: 'submitEncrypted',
            args: [BigInt(marketId), ciphertext, validationHash],
          });
          return { submitData };
        })
      );

      const approveData = encodeFunctionData({
        abi: [approveFragment],
        functionName: 'approve',
        args: [marketAddress, fundPerAgent],
      });

      // TX 1: Deploy agents (skips already-deployed ones)
      await runTx(
        () => writeContractAsync({ address: factoryAddress, abi: FACTORY_ABI, functionName: 'deployAgents', args: [agentIndices] }),
        `TX 1/${totalTxs}: Deploy agents…`
      );

      // TX 2: Approve factory to pull USDC from your wallet
      await runTx(
        () => writeContractAsync({ address: usdcAddress, abi: ERC20_ABI, functionName: 'approve', args: [factoryAddress, totalFund] }),
        `TX 2/${totalTxs}: Approve USDC for factory…`
      );

      // TX 3: Fund all agents in one call
      await runTx(
        () => writeContractAsync({ address: factoryAddress, abi: FACTORY_ABI, functionName: 'batchFundAgents', args: [agentIndices, usdcAddress, fundPerAgent] }),
        `TX 3/${totalTxs}: Fund agents…`
      );

      // TX 4..3+N: each agent approves the market to spend their USDC
      // TX 4+N..3+2N: each agent submits their encrypted vote
      // Interleaved: approve then submit per agent
      for (let i = 0; i < N; i++) {
        const agentIndex = agentIndices[i];
        const approveNum = 4 + i;
        const submitNum = 4 + N + i;

        await runTx(
          () => writeContractAsync({ address: factoryAddress, abi: FACTORY_ABI, functionName: 'execute', args: [agentIndex, usdcAddress, 0n, approveData] }),
          `TX ${approveNum}/${totalTxs}: Agent ${selectedAgents[i]} approve USDC…`
        );

        await runTx(
          () => writeContractAsync({ address: factoryAddress, abi: FACTORY_ABI, functionName: 'execute', args: [agentIndex, marketAddress, 0n, predictions[i].submitData] }),
          `TX ${submitNum}/${totalTxs}: Agent ${selectedAgents[i]} submit vote…`
        );
      }

      setAgentAddresses(agentAddrs);
      setStep('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  if (!canProceed) {
    return (
      <div className="rounded-xl p-4 text-xs" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#FCA5A5' }}>
        Set NEXT_PUBLIC_MARKET_ADDRESS, NEXT_PUBLIC_FACTORY_ADDRESS, and NEXT_PUBLIC_USDC_ADDRESS in .env.local
      </div>
    );
  }

  const steps: { n: Step; label: string }[] = [
    { n: 1, label: 'Create market' },
    { n: 2, label: 'Deploy, fund & cast votes' },
  ];

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex gap-2 flex-wrap">
        {steps.map((s) => (
          <div
            key={s.n}
            className="px-2 py-1 rounded text-xs font-medium"
            style={
              step === s.n
                ? { background: 'rgba(42,90,218,0.2)', color: '#60A5FA' }
                : step >= (s.n as number) || step === 'done'
                ? { background: 'rgba(16,185,129,0.15)', color: '#34D399' }
                : { background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }
            }
          >
            {s.n}. {s.label}
          </div>
        ))}
      </div>

      {/* Step 1: Create market */}
      {step === 1 && (
        <form onSubmit={handleStep1} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Market question
            </label>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="input"
              placeholder="Will ETH reach $5,000 by end of Q2 2025?"
              required
              disabled={busy}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Max slots
              </label>
              <input
                type="number"
                value={maxSlots}
                onChange={(e) => setMaxSlots(e.target.value)}
                className="input"
                min="1"
                max="100"
                disabled={busy}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Ticket cost (USDC)
              </label>
              <input
                type="text"
                value={ticketCost}
                onChange={(e) => setTicketCost(e.target.value)}
                className="input"
                placeholder="0.00001"
                disabled={busy}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Creator offer (USDC)
            </label>
            <input
              type="text"
              value={creatorOffer}
              onChange={(e) => setCreatorOffer(e.target.value)}
              className="input"
              disabled={busy}
            />
          </div>
          <div className="rounded-xl px-4 py-3 space-y-3"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
            <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              Timeline
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  Phase 1 ends in (min)
                </label>
                <input
                  type="number"
                  value={phase1EndMinutes}
                  onChange={(e) => setPhase1EndMinutes(e.target.value)}
                  className="input"
                  min="1"
                  max="120"
                  disabled={busy}
                />
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Info collection & reveal
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  Phase 2 ends in (min)
                </label>
                <input
                  type="number"
                  value={phase2EndMinutes}
                  onChange={(e) => setPhase2EndMinutes(e.target.value)}
                  className="input"
                  min="2"
                  max="1440"
                  disabled={busy}
                />
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Trading closes
                </div>
              </div>
            </div>
            {Number(phase2EndMinutes) <= Number(phase1EndMinutes) && (
              <div className="text-[10px]" style={{ color: '#F87171' }}>
                Phase 2 must end after Phase 1
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Options
            </label>
            <input
              type="number"
              value={optionCount}
              onChange={(e) => {
                const n = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
                setOptionCount(String(n));
                setOptionLabels((prev) => {
                  const next = [...prev];
                  while (next.length < n) next.push('');
                  return next.slice(0, n);
                });
              }}
              className="input"
              min="1"
              max="10"
              disabled={busy}
            />
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Number of submarkets (1 = binary YES/NO)
            </div>
            {Number(optionCount) > 1 && (
              <div className="mt-3 space-y-2">
                {Array.from({ length: Math.max(1, parseInt(optionCount, 10) || 1) }, (_, i) => (
                  <div key={i}>
                    <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                      Option {i + 1} label
                    </label>
                    <input
                      value={optionLabels[i] ?? ''}
                      onChange={(e) => setOptionLabels((prev) => {
                        const next = [...prev];
                        next[i] = e.target.value;
                        return next;
                      })}
                      className="input"
                      placeholder="e.g. ETH &gt; $5,000"
                      disabled={busy}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl px-4 py-3 text-xs" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
            Total: {(Number(totalDeposit) / 1e6).toFixed(6)} USDC
          </div>
          <button type="submit" disabled={busy || Number(phase2EndMinutes) <= Number(phase1EndMinutes)} className="btn-primary w-full justify-center gap-2">
            {busy ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {progress || 'Creating…'}
              </>
            ) : (
              'Create market'
            )}
          </button>
        </form>
      )}

      {/* Step 2: Deploy, fund & cast (atomic multicall) */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Select agents. Each agent needs 2 txs (approve + submit) after 3 setup txs — {3 + selectedAgents.length * 2} total confirmations.
          </p>
          <div className="flex flex-wrap gap-2">
            {AGENT_INDICES.map((i) => (
              <label key={i} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedAgents.includes(i)}
                  onChange={(e) =>
                    setSelectedAgents((prev) =>
                      e.target.checked ? [...prev, i] : prev.filter((x) => x !== i)
                    )
                  }
                />
                <span className="text-xs font-mono">Agent {i}</span>
                {addrs[i] && (
                  <span className="text-[10px] truncate max-w-[80px]" style={{ color: 'var(--text-muted)' }}>
                    {String(addrs[i]).slice(0, 8)}…
                  </span>
                )}
              </label>
            ))}
          </div>
          <div className="rounded-xl px-4 py-3 text-xs" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
            Total: {(Number(totalFund) / 1e6).toFixed(6)} USDC ({selectedAgents.length} × {(Number(fundPerAgent) / 1e6).toFixed(6)})
          </div>
          <button
            onClick={handleStep2}
            disabled={busy || selectedAgents.length === 0}
            className="btn-primary w-full justify-center gap-2"
          >
            {busy ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {progress || 'Processing…'}
              </>
            ) : (
              `Deploy, fund & cast [${selectedAgents.join(',')}]`
            )}
          </button>
        </div>
      )}

      {/* Done */}
      {step === 'done' && marketId && (
        <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', color: '#34D399' }}>
          <p className="text-sm font-medium">All votes cast for market #{marketId}</p>
          <Link href={`/market/${marketId}`} className="btn-secondary text-xs mt-3 inline-flex">
            View market →
          </Link>
        </div>
      )}

      {error && (
        <div className="rounded-xl p-4 text-xs font-mono break-all" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', color: '#FCA5A5' }}>
          {error}
        </div>
      )}
    </div>
  );
}
