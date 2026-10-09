// Small summary tile; clickable when `onClick` is given (e.g. to apply a filter).
export default function StatCard({ label, value, of, foot, tone = '', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`seat-stat${tone ? ` seat-stat-${tone}` : ''}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="seat-stat-label">{label}</span>
      <span className="seat-stat-value">
        {value}
        {of && <small> / {of}</small>}
      </span>
      {foot && <span className="seat-stat-foot">{foot}</span>}
    </Tag>
  );
}
