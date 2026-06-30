import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

interface ParsedAnimatedValue {
  fractionDigits: number;
  prefix: string;
  suffix: string;
  target: number;
}

interface AnimatedDonutItem {
  color: string;
  id: string;
  title?: string;
  value: number;
}

const NUMBER_PATTERN = /-?\d[\d\s\u00a0.,]*/;

function prefersReducedMotion() {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function parseAnimatedValue(value: ReactNode): ParsedAnimatedValue | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      fractionDigits: Number.isInteger(value) ? 0 : 1,
      prefix: '',
      suffix: '',
      target: value,
    };
  }

  if (typeof value !== 'string') return null;

  const match = value.match(NUMBER_PATTERN);
  if (!match || match.index == null) return null;

  const rawNumber = match[0].trimEnd();
  const compactNumber = rawNumber.replace(/[\s\u00a0]/g, '');
  const commaCount = compactNumber.match(/,/g)?.length ?? 0;
  const dotCount = compactNumber.match(/\./g)?.length ?? 0;
  const lastCommaIndex = compactNumber.lastIndexOf(',');
  const lastDotIndex = compactNumber.lastIndexOf('.');
  const commaIsDecimal =
    commaCount === 1 &&
    lastCommaIndex !== -1 &&
    (lastDotIndex === -1 || lastCommaIndex > lastDotIndex);
  const dotIsDecimal =
    !commaIsDecimal &&
    dotCount === 1 &&
    lastDotIndex !== -1 &&
    lastDotIndex > lastCommaIndex;
  let decimalPart = '';
  let normalized = compactNumber.replace(/,/g, '');

  if (commaIsDecimal) {
    decimalPart = compactNumber.slice(lastCommaIndex + 1);
    normalized = `${compactNumber
      .slice(0, lastCommaIndex)
      .replace(/[,.]/g, '')}.${decimalPart}`;
  } else if (dotIsDecimal) {
    decimalPart = compactNumber.slice(lastDotIndex + 1);
    normalized = `${compactNumber
      .slice(0, lastDotIndex)
      .replace(/[,.]/g, '')}.${decimalPart}`;
  }
  const target = Number(normalized);

  if (!Number.isFinite(target)) return null;

  return {
    fractionDigits: decimalPart.length,
    prefix: value.slice(0, match.index),
    suffix: value.slice(match.index + rawNumber.length),
    target,
  };
}

function useAnimatedNumber(target: number, duration = 720) {
  const [current, setCurrent] = useState(0);
  const reducedMotion = prefersReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion()) {
      return;
    }

    let frame = 0;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(target * eased);

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [duration, target]);

  return reducedMotion ? target : current;
}

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number,
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;

  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeDonutSegment(
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = polarToCartesian(centerX, centerY, outerRadius, endAngle);
  const outerEnd = polarToCartesian(centerX, centerY, outerRadius, startAngle);
  const innerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
  const innerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
}

export function AnimatedMetricValue({
  className,
  duration,
  value,
}: {
  className?: string;
  duration?: number;
  value: ReactNode;
}) {
  const parsed = useMemo(() => parseAnimatedValue(value), [value]);
  const current = useAnimatedNumber(parsed?.target ?? 0, duration);

  if (!parsed) {
    return <>{value}</>;
  }

  const formatted = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: parsed.fractionDigits,
    minimumFractionDigits: parsed.fractionDigits,
  }).format(current);

  return (
    <span className={className}>
      {parsed.prefix}
      {formatted}
      {parsed.suffix}
    </span>
  );
}

export function AnimatedDonut({
  ariaLabel,
  className,
  innerRadius = 64,
  items,
  outerRadius = 92,
  showTrack = true,
  size = 220,
}: {
  ariaLabel: string;
  className?: string;
  innerRadius?: number;
  items: AnimatedDonutItem[];
  outerRadius?: number;
  showTrack?: boolean;
  size?: number;
}) {
  const rawMaskId = useId();
  const maskId = `crm-donut-${rawMaskId.replace(/:/g, '')}`;
  const center = size / 2;
  const visibleItems = items.filter((item) => Number(item.value) > 0);
  const total = visibleItems.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const trackRadius = (outerRadius + innerRadius) / 2;
  const trackWidth = outerRadius - innerRadius;
  const maskWidth = trackWidth + 8;
  const circumference = 2 * Math.PI * trackRadius;
  let cursorAngle = 0;

  return (
    <svg
      aria-label={ariaLabel}
      className={cn('h-full w-full', className)}
      role="img"
      viewBox={`0 0 ${size} ${size}`}
    >
      <defs>
        <mask id={maskId}>
          <rect fill="black" height={size} width={size} />
          <circle
            className="crm-donut-mask"
            cx={center}
            cy={center}
            fill="none"
            r={trackRadius}
            stroke="white"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
            strokeLinecap="butt"
            strokeWidth={maskWidth}
            style={
              {
                '--crm-donut-circ': circumference,
              } as CSSProperties
            }
            transform={`rotate(-90 ${center} ${center})`}
          />
        </mask>
      </defs>
      {showTrack && (
        <circle
          cx={center}
          cy={center}
          fill="none"
          r={trackRadius}
          stroke="hsl(var(--muted))"
          strokeWidth={trackWidth}
        />
      )}
      <g mask={`url(#${maskId})`}>
        {total > 0 &&
          visibleItems.map((item, index) => {
            const value = Number(item.value || 0);
            const segmentAngle = total > 0 ? (value / total) * 360 : 0;
            const startAngle = cursorAngle;
            const nextAngle = cursorAngle + segmentAngle;
            const endAngle =
              segmentAngle >= 360 ? startAngle + 359.99 : nextAngle;
            cursorAngle = nextAngle;

            return (
              <path
                key={item.id}
                className="crm-donut-segment"
                d={describeDonutSegment(
                  center,
                  center,
                  outerRadius,
                  innerRadius,
                  startAngle,
                  endAngle,
                )}
                fill={item.color}
                stroke="hsl(var(--background))"
                strokeWidth="4"
                style={
                  {
                    animationDelay: `${index * 80}ms`,
                  } as CSSProperties
                }
              >
                {item.title && <title>{item.title}</title>}
              </path>
            );
          })}
      </g>
    </svg>
  );
}
