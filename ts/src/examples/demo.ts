import { 
  DRAND_QUICKNET, 
  currentRound, 
  roundToTime, 
  timeUntilRound,
  formatTimeRemaining,
  type PredictionPayload,
} from '../index.js';

async function main() {
  console.log('🔮 Cortex SDK Demo\n');
  console.log('═'.repeat(50));

  console.log('\n📊 Drand Network Info:');
  console.log(`  Chain Hash: ${DRAND_QUICKNET.chainHash}`);
  console.log(`  Genesis: ${new Date(DRAND_QUICKNET.genesis * 1000).toISOString()}`);
  console.log(`  Period: ${DRAND_QUICKNET.period}s`);

  const now = currentRound();
  console.log(`\n⏰ Current Round: ${now}`);
  console.log(`  Round Time: ${roundToTime(now).toISOString()}`);

  const futureRound = now + 100n;
  const targetTime = roundToTime(futureRound);
  const secondsUntil = timeUntilRound(futureRound);
  
  console.log(`\n🎯 Future Round: ${futureRound}`);
  console.log(`  Target Time: ${targetTime.toISOString()}`);
  console.log(`  Time Until: ${formatTimeRemaining(secondsUntil)}`);

  const prediction: PredictionPayload = {
    outcome: 1,
    agent: '0x1234567890123456789012345678901234567890',
    salt: 'random-salt-value-12345',
  };

  console.log('\n📝 Prediction Payload:');
  console.log(`  Outcome: ${prediction.outcome === 1 ? 'YES' : 'NO'}`);
  console.log(`  Agent: ${prediction.agent}`);
  console.log(`  Salt: ${prediction.salt}`);

  console.log('\n📦 To encrypt this prediction:');
  console.log('  const encrypted = await encryptPrediction(prediction, futureRound);');
  console.log('  // This ciphertext can only be decrypted after the target round');

  console.log('\n🔓 Decryption will be possible after:');
  console.log(`  ${targetTime.toISOString()}`);
  console.log(`  (${formatTimeRemaining(secondsUntil)} from now)`);

  console.log('\n' + '═'.repeat(50));
  console.log('✨ Demo complete!\n');
}

main().catch(console.error);
