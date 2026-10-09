// Knowledge Nest brand mark: an open book (pages flaring like wings) settled in a
// woven nest, with a spark above. `bg` is the badge colour, `fg` the drawing colour;
// the nest's outline stroke uses `bg` to cut it cleanly away from the book.

const TEAL = '#1d5470';
const SAND = '#c9bf9e';

export function LogoMark({ size = 40, bg = TEAL, fg = SAND, title = 'Knowledge Nest' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={title}>
      <rect width="48" height="48" rx="12" fill={bg} />
      <path d="M24 4.2q.7 3.1 3.6 3.8-2.9.7-3.6 3.8-.7-3.1-3.6-3.8 2.9-.7 3.6-3.8Z" fill={fg} />
      <path d="M23.2 28.5C19.5 24.8 14.6 22.7 9.6 22.9l1.6-10.6c5-.2 9.6 2 12 5.6Z" fill={fg} />
      <path d="M24.8 28.5c3.7-3.7 8.6-5.8 13.6-5.6l-1.6-10.6c-5-.2-9.6 2-12 5.6Z" fill={fg} />
      <path
        d="M13 16.3c3.3.2 6 1.5 7.8 3.4M12.4 19.6c3.2.2 5.9 1.5 7.7 3.4M35 16.3c-3.3.2-6 1.5-7.8 3.4M35.6 19.6c-3.2.2-5.9 1.5-7.7 3.4"
        stroke={bg} strokeWidth="1.1" strokeLinecap="round" fill="none" opacity=".55"
      />
      <path
        d="M6.5 25.8Q24 31.5 41.5 25.8C40.6 35 33.4 41 24 41S7.4 35 6.5 25.8Z"
        fill={fg} stroke={bg} strokeWidth="2.4" paintOrder="stroke" strokeLinejoin="round"
      />
      <g fill="none" stroke={bg} strokeWidth="1.3" strokeLinecap="round">
        <path d="M8.3 29.4Q24 34.6 39.7 29.4M11.6 35.2Q24 39.2 36.4 35.2" />
        <path
          d="M12.5 31.4l2.4 3.6M18 32.8l2 3.6M24 33.3v3.8M30 32.8l-2 3.6M35.5 31.4l-2.4 3.6M17 37.4l1.6 2.6M31 37.4l-1.6 2.6"
          opacity=".6"
        />
      </g>
      <path d="M4.2 24.2l4.6 2.6M43.8 24.2l-4.6 2.6" stroke={fg} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Full lockup: mark + "Knowledge Nest" wordmark + optional tagline.
 * tone="light" for dark backgrounds (sand badge), tone="dark" for light backgrounds (teal badge).
 */
export default function Logo({ size = 42, tone = 'dark', tagline = 'Reading Room' }) {
  const onDark = tone === 'light';
  return (
    <span className={`logo logo-${tone}`}>
      <LogoMark size={size} bg={onDark ? SAND : TEAL} fg={onDark ? TEAL : SAND} />
      <span className="logo-text">
        <span className="logo-name">
          Knowledge <em>Nest</em>
        </span>
        {tagline && <span className="logo-tagline">{tagline}</span>}
      </span>
    </span>
  );
}
