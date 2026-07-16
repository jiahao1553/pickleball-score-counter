import { useMemo } from 'react';

/* pickleball drawn as box-shadow pixel art on a 1-unit inner dot */
const BALL_MAP = [
  '....####....',
  '..########..',
  '.##########.',
  '.####o#####.',
  '############',
  '##o######o##',
  '######o#####',
  '###o######o#',
  '.#####o####.',
  '.##########.',
  '..########..',
  '....####....',
];
const PX = { xs: 2, sm: 3, lg: 5 };

export function PixelBall({ size = 'sm', flip = false }) {
  const px = PX[size] || 3;
  const shadow = useMemo(() => {
    const shadows = [];
    BALL_MAP.forEach((row, y) => {
      [...row].forEach((c, x) => {
        if (c === '#') shadows.push(`${x * px}px ${y * px}px 0 var(--ball)`);
        else if (c === 'o') shadows.push(`${x * px}px ${y * px}px 0 var(--ball-dark)`);
      });
    });
    return shadows.join(',');
  }, [px]);
  return (
    <span
      className={`pixel-ball ${size}${flip ? ' flip' : ''}`}
      style={{ width: px * 12, height: px * 12 }}
      aria-hidden="true"
    >
      <i style={{
        position: 'absolute', left: 0, top: 0,
        width: px, height: px, boxShadow: shadow,
      }} />
    </span>
  );
}
