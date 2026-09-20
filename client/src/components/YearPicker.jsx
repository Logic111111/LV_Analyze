export default function YearPicker({ value, onChange }) {
  return (
    <div className="badge-year">
      {[0, 1, 2, 3, 4, 5].map(y => (
        <button key={y} className={value === y ? 'on' : ''} onClick={() => onChange(y)}>
          {y === 0 ? 'Now' : '+' + y + 'y'}
        </button>
      ))}
    </div>
  );
}
