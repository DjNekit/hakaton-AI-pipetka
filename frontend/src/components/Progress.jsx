export default function Progress({ run }) {
  const pct = Math.round((run.progress || 0) * 100);
  return (
    <div className="progress" role="status" aria-live="polite">
      <h1 className="progress-file">{run.file}</h1>
      <p className="progress-stage">{run.stage || "В очереди"}</p>
      <div className="progress-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <p className="progress-note">
        {run.use_llm
          ? "С языковой моделью проверка занимает до пары минут: модель читает пояснительную записку и пишет заключение."
          : "Проверка по правилам занимает несколько секунд."}
      </p>
    </div>
  );
}
