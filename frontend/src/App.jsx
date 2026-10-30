import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import Sidebar from "./components/Sidebar.jsx";
import Report from "./components/Report.jsx";
import EmptyState from "./components/EmptyState.jsx";
import Progress from "./components/Progress.jsx";

function readHash() {
  const m = window.location.hash.match(/^#\/check\/([0-9a-f]{12})/);
  return m ? m[1] : null;
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [samples, setSamples] = useState([]);
  const [runs, setRuns] = useState([]);
  const [rules, setRules] = useState(null);
  const [currentId, setCurrentId] = useState(readHash());
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  // языковая модель используется всегда, когда доступна; иначе сервис сам работает по правилам
  const useLlm = true;

  const refreshRuns = useCallback(() => api.checks().then(setRuns).catch(() => {}), []);

  useEffect(() => {
    api.samples().then(setSamples).catch((e) => setError(`Бэкенд недоступен: ${e.message}`));
    api.rules().then(setRules).catch(() => {});
    refreshRuns();
    const loadHealth = () => api.health().then(setHealth).catch(() => setHealth(null));
    loadHealth();
    const t = setInterval(loadHealth, 20000);
    const onHash = () => setCurrentId(readHash());
    window.addEventListener("hashchange", onHash);
    return () => {
      clearInterval(t);
      window.removeEventListener("hashchange", onHash);
    };
  }, [refreshRuns]);

  // опрос состояния текущей проверки
  useEffect(() => {
    if (!currentId) {
      setRun(null);
      return undefined;
    }
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const data = await api.check(currentId);
        if (cancelled) return;
        setRun(data);
        setError(null);
        if (data.state === "queued" || data.state === "running") {
          timer = setTimeout(poll, 900);
        } else {
          refreshRuns();
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    setRun((prev) => (prev && prev.id === currentId ? prev : null));
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentId, refreshRuns]);

  const open = (id) => {
    window.location.hash = `#/check/${id}`;
  };

  const start = async (promise) => {
    setError(null);
    try {
      const status = await promise;
      refreshRuns();
      open(status.id);
    } catch (e) {
      setError(e.message);
    }
  };


  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/" aria-label="На главную">
          <span className="brand-fan" aria-hidden="true">
            <i style={{ background: "#C9B48A" }} />
            <i style={{ background: "#373F43" }} />
            <i style={{ background: "#CB8D73" }} />
          </span>
          <span className="brand-name">Колорпаспорт</span>
          <span className="brand-sub">проверка паспорта колористического решения, дизайн-проекта вывесок и фото фасада</span>
        </a>
        <LlmStatus health={health} />
      </header>
      <div className="layout">
        <Sidebar
          runs={runs}
          currentId={currentId}
          onUpload={(file) => start(api.upload(file, useLlm))}
          onOpen={open}
        />
        <main className="main" id="main">
          {error && (
            <div className="banner banner-error" role="alert">
              {error}
            </div>
          )}
          {!currentId && <EmptyState rules={rules} samples={samples} onSample={(n) => start(api.checkSample(n, useLlm))} />}
          {currentId && run && (run.state === "queued" || run.state === "running") && <Progress run={run} />}
          {currentId && run && run.state === "error" && (
            <div className="banner banner-error" role="alert">
              Проверка «{run.file}» не выполнена: {run.error}. Проверьте, что файл — паспорт в формате PDF, и запустите проверку ещё раз.
            </div>
          )}
          {currentId && run && run.state === "done" && run.report && <Report run={run} useLlm={useLlm} />}
        </main>
      </div>
    </div>
  );
}

function LlmStatus({ health }) {
  if (!health) return <span className="llm-status llm-off">Сервер проверки не отвечает</span>;
  const llm = health.llm || {};
  if (!llm.available)
    return (
      <span className="llm-status llm-off" title={llm.error || ""}>
        GigaChat недоступен — проверка по правилам
      </span>
    );
  return (
    <span className="llm-status llm-on" title="GigaChat API">
      <span className="dot" aria-hidden="true" /> GigaChat: {llm.model}
    </span>
  );
}
