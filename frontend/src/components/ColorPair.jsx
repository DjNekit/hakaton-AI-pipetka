// Пара «колеров» как в веере образцов: заявленный цвет и фактический, с ΔE00 между ними
export default function ColorPair({ expected, expectedLabel, actual, actualLabel, deltaE }) {
  return (
    <span className="chips">
      {expected && <Chip hex={expected} caption={expectedLabel || "заявлено"} />}
      {expected && actual && (
        <span className="chips-delta" title="Цветовое отличие CIEDE2000">
          ΔE {deltaE != null ? deltaE.toFixed(1) : "—"}
        </span>
      )}
      {actual && <Chip hex={actual} caption={actualLabel || "факт"} />}
    </span>
  );
}

export function Chip({ hex, caption, small }) {
  return (
    <span className={`chip${small ? " chip-small" : ""}`}>
      <span className="chip-color" style={{ background: hex }} />
      <span className="chip-caption">
        <span>{caption}</span>
        <span className="chip-hex">{hex}</span>
      </span>
    </span>
  );
}
