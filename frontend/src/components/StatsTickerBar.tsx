'use client';

const TOPIC_LABELS = [
  'Sports',
  'Politics',
  'Weather',
  'Finance',
  'Crypto',
  'Games',
  'Entertainment',
  'Science',
  'Tech',
  'Health',
  'Elections',
  'Space',
  'Art',
  'Music',
  'Food',
  'Travel',
  'Real Estate',
  'Education',
  'AI',
  'Energy',
  'Climate',
  'Media',
  'Fashion',
  'Gaming',
];

export function StatsTickerBar() {
  const doubled = [...TOPIC_LABELS, ...TOPIC_LABELS];

  return (
    <div
      className="overflow-hidden border-b select-none"
      style={{
        borderColor: 'rgba(33,41,58,0.7)',
        background: 'rgba(8,12,20,0.95)',
        height: '32px',
      }}
    >
      <div
        className="flex items-center h-full"
        style={{ width: 'max-content', animation: 'ticker 55s linear infinite' }}
      >
        {doubled.map((label, i) => (
          <span key={i} className="flex items-center h-full flex-shrink-0">
            <span
              className="font-medium px-5 text-sm whitespace-nowrap"
              style={{ color: 'rgba(255,255,255,0.7)' }}
            >
              {label}
            </span>
            <span
              className="flex-shrink-0 text-[9px]"
              style={{ color: 'rgba(255,255,255,0.15)', paddingRight: '4px' }}
            >
              ◆
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
