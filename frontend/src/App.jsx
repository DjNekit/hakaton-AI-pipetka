import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import Sidebar from "./components/Sidebar.jsx";
import Report from "./components/Report.jsx";
import EmptyState from "./components/EmptyState.jsx";
import Progress from "./components/Progress.jsx";
import PackageView from "./components/PackageView.jsx";

// #/package/<id> — пакет документов одной заявки, #/check/<id> — один документ пакета
function readHash() {
  const m = window.location.hash.match(/^#\/(package|check)\/([0-9a-f]{12})/);
  return m ? { kind: m[1], id: m[2] } : null;
}

const busyState = (s) => s === "queued" || s === "running";

export default function App() {
  const [health, setHealth] = useState(undefined); // undefined — ещё не знаем, null — сервис chat не отвечает
  const [samples, setSamples] = useState([]);
  const [packages, setPackages] = useState([]);
  const [rules, setRules] = useState(null);
  const [route, setRoute] = useState(readHash());
  const [pkg, setPkg] = useState(null);
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(null);

  const refreshPackages = useCallback(() => api.packages().then(setPackages).catch(() => {}), []);

  const updateRun = useCallback(
    (updated) => {
      setRun(updated);
      refreshPackages();
    },
    [refreshPackages],
  );

  useEffect(() => {
    api.samples().then(setSamples).catch((e) => setError(`Бэкенд недоступен: ${e.message}`));
    api.rules().then(setRules).catch(() => {});
    refreshPackages();
    const loadHealth = () => api.modelHealth().then(setHealth).catch(() => setHealth(null));
    loadHealth();
    const t = setInterval(loadHealth, 20000);
    const onHash = () => setRoute(readHash());
    window.addEventListener("hashchange", onHash);
    return () => {
      clearInterval(t);
      window.removeEventListener("hashchange", onHash);
    };
  }, [refreshPackages]);

  // опрос текущего пакета или документа, пока идёт проверка
  useEffect(() => {
    if (!route) {
      setPkg(null);
      setRun(null);
      return undefined;
    }
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const data = route.kind === "package" ? await api.package(route.id) : await api.check(route.id);
        if (cancelled) return;
        (route.kind === "package" ? setPkg : setRun)(data);
        setError(null);
        if (busyState(data.state)) timer = setTimeout(poll, 1200);
        else refreshPackages();
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    if (route.kind === "package") setPkg((prev) => (prev && prev.id === route.id ? prev : null));
    else setRun((prev) => (prev && prev.id === route.id ? prev : null));
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [route, refreshPackages]);

  const openPackage = (id) => {
    window.location.hash = `#/package/${id}`;
  };

  const start = async (promise) => {
    setError(null);
    try {
      const created = await promise;
      refreshPackages();
      openPackage(created.id);
    } catch (e) {
      setError(e.message);
    }
  };

  // файлы → checker (загрузка) → бэкенд (пакет и очередь проверки)
  const uploadPackage = async (files, title, service_type) => {
    setError(null);
    setUploading(`Загружаю ${files.length} ${files.length === 1 ? "файл" : files.length < 5 ? "файла" : "файлов"}…`);
    try {
      const { uploads, errors } = await api.uploadFiles(files);
      if (errors && errors.length) setError(`Не приняты: ${errors.join("; ")}`);
      setUploading("Создаю пакет…");
      await start(api.createPackage({ uploads, title, service_type }));
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(null);
    }
  };

  const currentPackageId = route && route.kind === "package" ? route.id : run && run.package_id;

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
          <span className="brand-sub">проверка пакета документов: паспорт колористического решения, дизайн-проект вывесок, фото фасада</span>
        </a>
        <a className="ui-switch" href="/new/" title="Новый интерфейс: заявки, роли заявителя и согласующего">
          Новый интерфейс →
        </a>
        <LlmStatus health={health} />
      </header>
      <div className="layout">
        <Sidebar packages={packages} currentId={currentPackageId} uploading={uploading} onUpload={uploadPackage} onOpen={openPackage} />
        <main className="main" id="main">
          {error && (
            <div className="banner banner-error" role="alert">
              {error}
            </div>
          )}
          {!route && <EmptyState rules={rules} samples={samples} onSample={(n) => start(api.checkSample(n))} />}
          {route && route.kind === "package" && pkg && <PackageView pkg={pkg} />}
          {route && route.kind === "check" && run && (
            <>
              {run.package_id && (
                <a className="back-link" href={`#/package/${run.package_id}`}>
                  ← Пакет документов
                </a>
              )}
              {busyState(run.state) && <Progress run={run} />}
              {run.state === "error" && (
                <div className="banner banner-error" role="alert">
                  Проверка «{run.file}» не выполнена: {run.error}. Проверьте, что файл — паспорт или дизайн-проект в формате PDF.
                </div>
              )}
              {run.state === "done" && run.report && <Report run={run} modelOn={Boolean(health && health.available)} onUpdate={updateRun} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// Статус языковой модели — от сервиса chat. Проверка по правилам работает и без модели.
function LlmStatus({ health: llm }) {
  if (llm === undefined) return null;
  if (!llm) return <span className="llm-status llm-off">Сервис ИИ не отвечает — проверка по правилам</span>;
  if (!llm.available)
    return (
      <span className="llm-status llm-off" title={llm.error || ""}>
        Модель недоступна — проверка по правилам
      </span>
    );
  return (
    <span className="llm-status llm-on" title="GigaChat API">
      <span className="dot" aria-hidden="true" /> GigaChat: {llm.model}
    </span>
  );
}
