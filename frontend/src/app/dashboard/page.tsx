'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { useWallet } from '@/hooks/useWallet';
import { useWriteContract, useConfig } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';
import { getAgentMarkets, getAgentStats, type AgentMarket, type AgentStats } from '@/lib/agentApi';
import { CreateMarketWizard } from '@/components/CreateMarketWizard';
import { formatDistanceToNow } from '@/lib/utils';

// ---- Create Market Form --------------------------------------------------------

const DRAND_GENESIS = 1692803367;
const DRAND_PERIOD = 3;
const DRAND_CHAIN_HASH = '0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971' as `0x${string}`;

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

const MINIMARKET_ABI = [
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
] as const;

type TxPhase = 'idle' | 'approving' | 'approved' | 'creating' | 'done' | 'error';

function CreateMarketForm() {
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const [question, setQuestion] = useState('');
  const [maxSlots, setMaxSlots] = useState('5');
  const [ticketCost, setTicketCost] = useState('1');
  const [creatorOffer, setCreatorOffer] = useState('0.5');
  const [phase1EndMinutes, setPhase1EndMinutes] = useState('3');
  const [phase2EndMinutes, setPhase2EndMinutes] = useState('5');
  const [optionCount, setOptionCount] = useState('1');
  const [optionLabels, setOptionLabels] = useState<string[]>(['']);
  const [phase, setPhase] = useState<TxPhase>('idle');
  const [error, setError] = useState('');
  const [marketId, setMarketId] = useState<string | null>(null);

  const busy = phase === 'approving' || phase === 'approved' || phase === 'creating';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMarketId(null);

    const marketAddress = process.env.NEXT_PUBLIC_MARKET_ADDRESS as `0x${string}` | undefined;
    const usdcAddress = process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}` | undefined;
    if (!marketAddress) { setError('NEXT_PUBLIC_MARKET_ADDRESS not set'); setPhase('error'); return; }
    if (!usdcAddress) { setError('NEXT_PUBLIC_USDC_ADDRESS not set'); setPhase('error'); return; }

    const maxSlotsVal = BigInt(maxSlots);
    const ticketCostVal = BigInt(Math.round(Number(ticketCost) * 1e6));
    const creatorOfferVal = BigInt(Math.round(Number(creatorOffer) * 1e6));
    const p1 = Math.max(1, Math.round(Number(phase1EndMinutes)));
    const p2 = Math.max(p1 + 1, Math.round(Number(phase2EndMinutes)));
    const tradingDurationVal = p2 * 60; // seconds from creation until trading ends
    const now = Math.floor(Date.now() / 1000);
    const drandTargetRound = BigInt(
      Math.floor((now - DRAND_GENESIS) / DRAND_PERIOD) + Math.round(p1 * 60 / DRAND_PERIOD)
    );
    const optCount = Math.max(1, Math.min(10, parseInt(optionCount, 10) || 1));
    const totalDeposit = maxSlotsVal * ticketCostVal + creatorOfferVal * BigInt(optCount);
    const schemaJson = JSON.stringify({ question, version: 1 });

    try {
      // Step 1: Approve USDC
      setPhase('approving');
      const approveTx = await writeContractAsync({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [marketAddress, totalDeposit],
      });
      setPhase('approved');
      await waitForTransactionReceipt(config, { hash: approveTx });

      // Step 2: Create market
      setPhase('creating');
      const createTx = await writeContractAsync({
        address: marketAddress,
        abi: MINIMARKET_ABI,
        functionName: 'createMarket',
        args: [question, schemaJson, maxSlotsVal, ticketCostVal, creatorOfferVal, drandTargetRound, DRAND_CHAIN_HASH, tradingDurationVal, BigInt(optCount)],
      });
      const receipt = await waitForTransactionReceipt(config, { hash: createTx });

      // Pull marketId from logs (first topic of MarketCreated is marketId)
      const createdLog = receipt.logs[0];
      const newMarketId = createdLog ? BigInt(createdLog.topics[1] ?? '0x0') : null;
      if (newMarketId && optCount > 0) {
        for (let i = 0; i < optCount; i++) {
          const label = (optionLabels[i] ?? '').trim() || (optCount === 1 ? question : `Option ${i + 1}`);
          const subTx = await writeContractAsync({
            address: marketAddress,
            abi: MINIMARKET_ABI,
            functionName: 'createSubmarket',
            args: [newMarketId, BigInt(i), label],
          });
          await waitForTransactionReceipt(config, { hash: subTx });
        }
      }
      setMarketId(newMarketId?.toString() ?? null);
      setPhase('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('User rejected') ? 'Transaction rejected.' : msg);
      setPhase('error');
    }
  };

  const phaseLabel: Record<TxPhase, string> = {
    idle: 'Create Market',
    approving: 'Approve USDC in wallet…',
    approved: 'Waiting for approval…',
    creating: 'Confirm in wallet…',
    done: 'Market Created!',
    error: 'Create Market',
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
          Market Question
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
            Max Slots (participants)
          </label>
          <input
            type="number"
            value={maxSlots}
            onChange={(e) => setMaxSlots(e.target.value)}
            className="input"
            min="1"
            max="100"
            required
            disabled={busy}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Ticket Cost (USDC)
          </label>
          <input
            type="number"
            value={ticketCost}
            onChange={(e) => setTicketCost(e.target.value)}
            className="input"
            step="0.1"
            min="0.1"
            required
            disabled={busy}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
          Creator Offer (USDC)
        </label>
        <input
          type="number"
          value={creatorOffer}
          onChange={(e) => setCreatorOffer(e.target.value)}
          className="input"
          step="0.1"
          min="0"
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
              placeholder="3"
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
              placeholder="5"
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
                  placeholder={`e.g. ETH &gt; $5,000`}
                  disabled={busy}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cost summary */}
      <div className="rounded-xl px-4 py-3 text-xs space-y-1"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
        <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}>
          <span>Market cap ({maxSlots} × {ticketCost} USDC)</span>
          <span className="font-mono text-white">{(Number(maxSlots) * Number(ticketCost)).toFixed(2)} USDC</span>
        </div>
        <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}>
          <span>Creator offer ({Math.max(1, parseInt(optionCount, 10) || 1)} × {creatorOffer} USDC)</span>
          <span className="font-mono text-white">{(Number(creatorOffer) * Math.max(1, parseInt(optionCount, 10) || 1)).toFixed(2)} USDC</span>
        </div>
        <div className="flex justify-between font-semibold pt-1"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          <span>Total USDC required</span>
          <span className="font-mono" style={{ color: '#60A5FA' }}>
            {(Number(maxSlots) * Number(ticketCost) + Number(creatorOffer) * Math.max(1, parseInt(optionCount, 10) || 1)).toFixed(2)} USDC
          </span>
        </div>
      </div>

      {/* Step indicators when busy */}
      {(busy || phase === 'done') && (
        <div className="rounded-xl px-4 py-3 space-y-2 text-xs"
          style={{ background: 'rgba(42,90,218,0.06)', border: '1px solid rgba(42,90,218,0.2)' }}>
          {[
            { key: 'approve', label: 'Approve USDC spend', done: phase === 'approved' || phase === 'creating' || phase === 'done' },
            { key: 'create', label: 'Create market on-chain', done: phase === 'done' },
          ].map((step) => (
            <div key={step.key} className="flex items-center gap-2">
              {step.done ? (
                <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="#60A5FA" strokeWidth="4" />
                  <path className="opacity-75" fill="#60A5FA" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              <span style={{ color: step.done ? '#34D399' : '#60A5FA' }}>{step.label}</span>
            </div>
          ))}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || phase === 'done' || Number(phase2EndMinutes) <= Number(phase1EndMinutes)}
        className="btn-primary w-full justify-center gap-2"
        style={phase === 'done' ? { background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#34D399' } : {}}
      >
        {busy ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {phaseLabel[phase]}
          </>
        ) : phase === 'done' ? (
          <>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {phaseLabel.done}
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {phaseLabel[phase]}
          </>
        )}
      </button>

      {phase === 'done' && marketId && (
        <div className="rounded-xl p-4 text-xs text-center"
          style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', color: '#34D399' }}>
          Market #{marketId} created!{' '}
          <Link href={`/market/${marketId}`} className="underline">View market →</Link>
        </div>
      )}

      {phase === 'error' && error && (
        <div className="rounded-xl p-4 text-xs font-mono break-all"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', color: '#FCA5A5' }}>
          {error}
        </div>
      )}

      {phase === 'done' && (
        <button
          type="button"
          onClick={() => { setPhase('idle'); setQuestion(''); setMarketId(null); }}
          className="btn-ghost w-full justify-center text-xs"
        >
          Create another market
        </button>
      )}
    </form>
  );
}

// ---- Position row -------------------------------------------------------------

function PositionRow({ market }: { market: AgentMarket }) {
  // Aggregate across submarkets
  const yesShares = market.submarkets.reduce((s, sub) => s + Number(sub.yesShares), 0) / 1e6;
  const noShares = market.submarkets.reduce((s, sub) => s + Number(sub.noShares), 0) / 1e6;
  const payout = market.submarkets.reduce((s, sub) => s + Number(sub.totalPayout), 0) / 1e6;
  const resolvedSubs = market.submarkets.filter((sub) => sub.wasCorrect !== null);
  const wasCorrect = resolvedSubs.length > 0 ? resolvedSubs.some((sub) => sub.wasCorrect) : null;

  return (
    <div className="py-3 flex items-center justify-between text-sm border-b last:border-0"
      style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
      <div className="flex items-center gap-3">
        <div className="text-xs font-mono px-2 py-0.5 rounded"
          style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
          #{market.marketId.toString()}
        </div>
        <div>
          <div className="flex items-center gap-2 text-xs">
            {(yesShares > 0 || noShares > 0) && (() => {
              const total = yesShares + noShares;
              return total > 0 ? (
                <>
                  <span className="font-mono" style={{ color: '#34D399' }}>
                    {(yesShares / total * 100).toFixed(0)}% YES
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>/</span>
                  <span className="font-mono" style={{ color: '#F87171' }}>
                    {(noShares / total * 100).toFixed(0)}% NO
                  </span>
                </>
              ) : null;
            })()}
          </div>
          {payout > 0 && (
            <div className="text-xs font-mono mt-0.5" style={{ color: '#FBBF24' }}>
              Claimed: {payout.toFixed(4)} USDC
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {wasCorrect !== null && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: wasCorrect ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              color: wasCorrect ? '#34D399' : '#F87171',
            }}>
            {wasCorrect ? 'Won' : 'Lost'}
          </span>
        )}
        <Link href={`/market/${market.marketId}`} className="btn-ghost text-xs py-1 px-2">
          View →
        </Link>
      </div>
    </div>
  );
}

// ---- Main Dashboard ----------------------------------------------------------

export default function Dashboard() {
  const { isConnected, address, connect, shortAddress } = useWallet();
  const [tab, setTab] = useState<'positions' | 'create'>('positions');
  const [markets, setMarkets] = useState<AgentMarket[]>([]);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    Promise.all([
      getAgentMarkets(address, 20, 0).catch(() => []),
      getAgentStats(address).catch(() => null),
    ]).then(([mkts, st]) => {
      setMarkets(mkts);
      setStats(st);
      setLoading(false);
    });
  }, [address]);

  if (!isConnected) {
    return (
      <div className="min-h-screen ambient-bg">
        <Header />
        <div className="container mx-auto px-4 py-20 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
            style={{ background: 'linear-gradient(135deg, #2A5ADA, #7C3AED)' }}>
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Connect your wallet</h1>
          <p className="text-sm mb-8 max-w-sm" style={{ color: 'var(--text-muted)' }}>
            Connect your wallet to view your positions, track PnL, and create new prediction markets.
          </p>
          <button onClick={connect} className="btn-primary gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  const totalWinnings = stats ? Number(stats.totalWinnings) / 1e6 : 0;
  const totalStaked = stats ? Number(stats.totalStaked) / 1e6 : 0;
  const winRate = stats && Number(stats.totalSubmissions) > 0
    ? (Number(stats.totalCorrectPredictions) / Number(stats.totalSubmissions) * 100).toFixed(0)
    : '—';

  return (
    <div className="min-h-screen ambient-bg">
      <Header />

      <div className="container mx-auto px-4 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <div className="text-xs font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
              {shortAddress}
            </div>
          </div>
          <Link href="/" className="btn-ghost text-sm gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Markets
          </Link>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[
            {
              label: 'Markets Joined',
              value: stats ? Number(stats.totalMarketsParticipated).toString() : '—',
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              ),
              color: '#60A5FA',
            },
            {
              label: 'Win Rate',
              value: winRate !== '—' ? `${winRate}%` : '—',
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
              color: '#34D399',
            },
            {
              label: 'Total Staked',
              value: totalStaked > 0 ? `${totalStaked.toFixed(6)} USDC` : '—',
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
              color: '#FBBF24',
            },
            {
              label: 'Net P&L',
              value: totalStaked > 0 ? `${(totalWinnings - totalStaked) >= 0 ? '+' : ''}${(totalWinnings - totalStaked).toFixed(6)} USDC` : '—',
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              ),
              color: '#A78BFA',
            },
          ].map((stat) => (
            <div key={stat.label} className="card-flat">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg" style={{ background: `${stat.color}18` }}>
                  <div style={{ color: stat.color }}>{stat.icon}</div>
                </div>
              </div>
              <div className="stat-value text-xl">{stat.value}</div>
              <div className="stat-label mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Main content area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Tabs */}
          <div className="lg:col-span-2">
            {/* Tab bar */}
            <div className="flex gap-1 mb-4 p-1 rounded-xl w-fit"
              style={{ background: 'rgba(13,17,23,0.8)', border: '1px solid var(--border)' }}>
              {(['positions', 'create'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150"
                  style={tab === t ? {
                    background: 'rgba(42,90,218,0.2)',
                    color: '#60A5FA',
                    border: '1px solid rgba(42,90,218,0.25)',
                  } : {
                    color: 'var(--text-muted)',
                  }}
                >
                  {t === 'positions' ? 'My Positions' : 'Create Market'}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {tab === 'positions' && (
              <div className="card-glow">
                <h2 className="section-title text-sm">Your Market Positions</h2>
                {loading ? (
                  <div className="space-y-3">
                    {[1,2,3].map(i => (
                      <div key={i} className="h-10 rounded-lg animate-pulse"
                        style={{ background: 'rgba(255,255,255,0.03)' }} />
                    ))}
                  </div>
                ) : markets.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      No market positions yet.
                    </p>
                    <Link href="/#markets" className="btn-secondary text-xs mt-3 inline-flex">
                      Browse Markets →
                    </Link>
                  </div>
                ) : (
                  <div>
                    {markets.map((m) => (
                      <PositionRow key={m.id} market={m} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'create' && (
              <div className="card-glow">
                <h2 className="section-title text-sm">
                  {process.env.NEXT_PUBLIC_FACTORY_ADDRESS
                    ? 'Create Market + Simulate Agents'
                    : 'Create a New Market'}
                </h2>
                {process.env.NEXT_PUBLIC_FACTORY_ADDRESS ? (
                  <>
                    <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                      Create a market, deploy fake agents via the factory, fund them, and cast encrypted votes to test the protocol.
                    </p>
                    <CreateMarketWizard />
                  </>
                ) : (
                  <CreateMarketForm />
                )}
              </div>
            )}
          </div>

          {/* Right: Quick info */}
          <div className="space-y-4">
            <div className="card-flat">
              <h3 className="section-title text-sm">Quick Guide</h3>
              <div className="space-y-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                {[
                  { n: '1', title: 'InfoMarket', desc: 'Agents submit encrypted predictions during the collection phase.' },
                  { n: '2', title: 'CRE Reveals', desc: 'Chainlink CRE decrypts via drand and computes consensus.' },
                  { n: '3', title: 'PredictionMarket', desc: 'Agents trade YES/NO shares based on revealed info.' },
                  { n: '4', title: 'Claim', desc: 'Winners claim payouts. Wrong predictions incur penalties.' },
                ].map((item) => (
                  <div key={item.n} className="flex gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                      style={{ background: 'rgba(42,90,218,0.15)', color: '#60A5FA' }}>
                      {item.n}
                    </div>
                    <div>
                      <div className="font-medium text-white text-xs mb-0.5">{item.title}</div>
                      <div>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-flat">
              <h3 className="text-xs font-semibold text-white mb-2">Connected as</h3>
              <div className="font-mono text-xs break-all" style={{ color: '#60A5FA' }}>
                {address}
              </div>
              <Link href={`/agent/${address}`} className="btn-secondary text-xs w-full justify-center mt-3 inline-flex">
                View Agent Profile →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
