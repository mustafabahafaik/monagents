import { useEffect, useMemo, useRef, useState } from "react";
import { formatEther } from "viem";
import { dep, publicClient } from "./chain.js";

// Stage coordinates are % of the stage box.
const HOME = { x: 50, y: 50 };
const STATIONS = {
  scout: { x: 50, y: 11, icon: "🔍", label: "Repo Tarayıcı", sub: "GitHub API", price: "ücretsiz" },
  frontend: { x: 14, y: 30, icon: "🎨", label: "Frontend Reviewer", sub: "UI · bileşenler", price: "0.02" },
  backend: { x: 14, y: 66, icon: "🛠️", label: "Backend Auditor", sub: "API · kontratlar", price: "0.03" },
  security: { x: 86, y: 30, icon: "🛡️", label: "Security Scanner", sub: "anahtar · .env", price: "0.03" },
  premium: { x: 86, y: 66, icon: "💎", label: "Full AI Rewrite", sub: "tüm repo", price: "0.08" },
  improver: { x: 34, y: 88, icon: "✨", label: "Code Improver", sub: "iyileştirme planı", price: "0.04" },
  shady: { x: 66, y: 88, icon: "🕶️", label: "ShadyDataBroker", sub: "listede değil", price: "0.01" },
};
const REASONS = {
  AGENT_PAUSED: "Ajan sahibi tarafından durduruldu",
  VENDOR_NOT_ALLOWED: "Satıcı izin listesinde değil",
  EXCEEDS_PER_TX_LIMIT: "İşlem başı limit aşıldı",
  EXCEEDS_DAILY_LIMIT: "Günlük limit aşıldı",
  VAULT_INSUFFICIENT: "Kasa bakiyesi yetersiz",
  TX_ERROR: "İşlem hatası (gas?)",
};
const SAMPLES = ["mustafabahafaik/monagents", "vitejs/vite", "OpenZeppelin/openzeppelin-contracts"];

const towards = (st, k = 0.7) => ({ x: HOME.x + (st.x - HOME.x) * k, y: HOME.y + (st.y - HOME.y) * k });
const fmt = (v, d = 2) => Number(formatEther(v ?? 0n)).toFixed(d);
const read = (functionName, args) => publicClient.readContract({ address: dep.address, abi: dep.abi, functionName, args });

export default function Landing() {
  const [repo, setRepo] = useState("mustafabahafaik/monagents");
  const [running, setRunning] = useState(false);
  const [pos, setPos] = useState(HOME);
  const [facing, setFacing] = useState(1);
  const [mood, setMood] = useState("idle");
  const [thought, setThought] = useState("Bir proje gönder, gerekli hizmetleri ben alayım.");
  const [stations, setStations] = useState({});
  const [findings, setFindings] = useState([]);
  const [log, setLog] = useState([]);
  const [result, setResult] = useState(null);
  const [repoMeta, setRepoMeta] = useState(null);
  const [coins, setCoins] = useState([]);
  const [chain, setChain] = useState(null);
  const [online, setOnline] = useState(null);
  const posRef = useRef(HOME);
  const esRef = useRef(null);

  // ------------------------------------------------------------ live chain
  useEffect(() => {
    if (!dep.address || !dep.agent) return;
    let stop = false;
    const tick = async () => {
      try {
        const [a, left, vendors, block] = await Promise.all([
          read("agents", [dep.agent]),
          read("remainingToday", [dep.agent]),
          read("getAgentVendors", [dep.agent]),
          publicClient.getBlockNumber(),
        ]);
        const allowed = await Promise.all(vendors.map((v) => read("isVendorAllowed", [dep.agent, v])));
        const [, name, maxPerTx, dailyLimit, , , , paymentCount, blockedCount, active] = a;
        if (!stop)
          setChain({
            name, maxPerTx, dailyLimit, active, block,
            spent: dailyLimit > left ? dailyLimit - left : 0n,
            paid: Number(paymentCount), blocked: Number(blockedCount),
            services: allowed.filter(Boolean).length,
          });
      } catch (e) {
        console.warn(e);
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((j) => setOnline(j)).catch(() => setOnline(false));
  }, [running]);

  // ------------------------------------------------------------- movement
  const moveTo = (key) => {
    const target = key === "home" ? HOME : towards(STATIONS[key], key === "scout" ? 0.5 : 0.52);
    setFacing(target.x < posRef.current.x ? -1 : 1);
    posRef.current = target;
    setPos(target);
    setMood("walk");
    setTimeout(() => setMood((m) => (m === "walk" ? "idle" : m)), 900);
  };

  const flash = (m) => {
    setMood(m);
    setTimeout(() => setMood("idle"), 1600);
  };

  const setSt = (key, patch) => setStations((s) => ({ ...s, [key]: { ...(s[key] || {}), ...patch } }));
  const addLog = (item) => setLog((l) => [{ id: Date.now() + Math.random(), time: new Date(), ...item }, ...l].slice(0, 40));

  // ---------------------------------------------------------------- review
  const start = (e) => {
    e?.preventDefault();
    if (running || !repo.trim()) return;
    setRunning(true);
    setStations({});
    setFindings([]);
    setLog([]);
    setResult(null);
    setRepoMeta(null);
    esRef.current?.close();
    const es = new EventSource(`/api/review?repo=${encodeURIComponent(repo.trim())}`);
    esRef.current = es;
    let ended = false;

    es.onmessage = (msg) => {
      const ev = JSON.parse(msg.data);
      switch (ev.t) {
        case "thought":
          setThought(ev.text);
          addLog({ kind: "think", text: ev.text });
          break;
        case "move":
          moveTo(ev.station);
          if (ev.station !== "home") setSt(ev.station, { state: "active" });
          break;
        case "start":
          setRepoMeta(ev.repo);
          break;
        case "pay":
          setSt(ev.station, { state: "paying" });
          setCoins((c) => [...c, { id: Date.now(), from: posRef.current, to: STATIONS[ev.station], amount: ev.amount }]);
          addLog({ kind: "pay", text: `${ev.amount} MON → ${ev.vendor}`, sub: ev.memo });
          break;
        case "paid":
          setSt(ev.station, { state: "paid", ms: ev.ms, tx: ev.tx });
          flash("happy");
          addLog({ kind: "ok", text: `Onaylandı · ${ev.ms} ms`, tx: ev.tx });
          break;
        case "blocked":
          setSt(ev.station, { state: "blocked", ms: ev.ms, tx: ev.tx, reason: ev.reason });
          flash("blocked");
          setThought(`Vault beni durdurdu: ${REASONS[ev.reason] || ev.reason}`);
          addLog({ kind: "bad", text: `ENGELLENDİ · ${REASONS[ev.reason] || ev.reason}`, tx: ev.tx });
          break;
        case "result":
          setSt(ev.station, { state: "done" });
          setFindings((f) => [...f, { station: ev.station, items: ev.findings }]);
          break;
        case "error":
          setSt(ev.station, { state: "blocked", reason: "TX_ERROR" });
          addLog({ kind: "bad", text: `İşlem hatası: ${ev.msg}` });
          break;
        case "done":
          setResult(ev);
          setThought(`Bitti! ${ev.paid} hizmet aldım, ${ev.blocked} deneme zincirde engellendi.`);
          flash("happy");
          break;
        case "fatal":
          setThought(ev.msg);
          addLog({ kind: "bad", text: ev.msg });
          moveTo("home");
          break;
        case "end":
          ended = true;
          es.close();
          setRunning(false);
          break;
        default:
          break;
      }
    };
    es.onerror = () => {
      es.close();
      if (!ended) {
        setRunning(false);
        setThought("Ajan sunucusuna ulaşamadım. agent klasöründe `npm run server` çalışıyor mu?");
        moveTo("home");
      }
    };
  };

  const stars = useMemo(
    () => Array.from({ length: 90 }, (_, i) => ({ id: i, x: Math.random() * 100, y: Math.random() * 70, s: Math.random() * 2 + 0.6, d: Math.random() * 4 })),
    []
  );

  const spentPct = chain && chain.dailyLimit > 0n ? Number((chain.spent * 1000n) / chain.dailyLimit) / 10 : 0;

  return (
    <div className="lp">
      <div className="lp-sky">
        {stars.map((s) => (
          <i key={s.id} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />
        ))}
      </div>

      <header className="lp-head">
        <a className="lp-logo" href="#/">
          <img src="/mascot.png" alt="" /> MONAGENT
        </a>
        <nav>
          <span className={`lp-chip ${online ? "on" : "off"}`}>
            <b /> {online ? `Ajan çevrimiçi · ${online.name}` : online === false ? "Ajan sunucusu kapalı" : "…"}
          </span>
          <span className="lp-chip">
            <b className="g" /> Monad Testnet {chain && <span className="mono">#{chain.block.toString()}</span>}
          </span>
          <a className="lp-btn ghost" href="#/dashboard">Dashboard →</a>
        </nav>
      </header>

      <section className="lp-stats">
        <Stat label="Harcama (bugün)" value={chain ? `${fmt(chain.spent)} / ${fmt(chain.dailyLimit)} MON` : "—"}>
          <div className="lp-bar"><div style={{ width: `${Math.min(spentPct, 100)}%` }} className={spentPct > 85 ? "hot" : ""} /></div>
        </Stat>
        <Stat label="Kurallar" value={chain ? `${fmt(chain.maxPerTx)} / işlem · ${chain.services} servis` : "—"} />
        <Stat label="Kararlar" value={chain ? <><span className="g">{chain.paid} onay</span> · <span className="r">{chain.blocked} engel</span></> : "—"} />
        <Stat label="Ajan" value={chain ? <span className={chain.active ? "g" : "r"}>{chain.active ? `● ${chain.name}` : "⏸ DURDURULDU"}</span> : "—"} />
      </section>

      <section className="lp-stage">
        <Skyline />
        <svg className="lp-links" viewBox="0 0 100 100" preserveAspectRatio="none">
          {Object.entries(STATIONS).map(([k, s]) => (
            <line key={k} x1={HOME.x} y1={HOME.y} x2={s.x} y2={s.y} className={`l-${stations[k]?.state || "idle"}`} />
          ))}
        </svg>

        <div className="lp-platform" style={{ left: `${HOME.x}%`, top: `${HOME.y}%` }}>
          <div className="p1" /><div className="p2" /><div className="p3" />
        </div>
        <div className="lp-orbit" style={{ left: `${HOME.x}%`, top: `${HOME.y}%` }}><span /></div>

        {Object.entries(STATIONS).map(([k, s]) => (
          <Station key={k} k={k} s={s} st={stations[k]} />
        ))}

        {coins.map((c) => (
          <Coin key={c.id} c={c} onDone={() => setCoins((cs) => cs.filter((x) => x.id !== c.id))} />
        ))}

        <div className={`lp-mascot ${mood}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
          <div className="bubble">{thought}</div>
          <div className="halo" />
          <img src="/mascot.png" alt="MONAGENT maskotu" style={{ transform: `scaleX(${facing})` }} />
          <div className="shadow" />
        </div>
      </section>

      <section className="lp-hero">
        <h1>MONAGENT</h1>
        <p>Yapay zekâ ajanları hizmet satın alır. <b>Harcama kurallarını Monad zinciri uygular.</b></p>
        <form className="lp-form" onSubmit={start}>
          <span className="pre">github.com/</span>
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" disabled={running} />
          <button className="lp-btn" disabled={running}>{running ? "Ajan çalışıyor…" : "Projeyi ajana gönder 🚀"}</button>
        </form>
        <div className="lp-samples">
          {SAMPLES.map((s) => (
            <button key={s} onClick={() => setRepo(s)} disabled={running}>{s}</button>
          ))}
        </div>
      </section>

      <section className="lp-panels">
        <div className="lp-panel">
          <h3>Ajan günlüğü <span className="live">● CANLI</span></h3>
          {log.length === 0 && <div className="muted">Henüz işlem yok. Bir repo gönder.</div>}
          <div className="lp-log">
            {log.map((l) => (
              <div key={l.id} className={`row ${l.kind}`}>
                <span className="ic">{{ think: "💭", pay: "💸", ok: "✅", bad: "⛔" }[l.kind]}</span>
                <div>
                  <div>{l.text}</div>
                  {l.sub && <div className="sub">{l.sub}</div>}
                  {l.tx && (
                    <a href={`${dep.explorer}/tx/${l.tx}`} target="_blank" rel="noreferrer" className="sub mono">
                      {l.tx.slice(0, 18)}… ↗
                    </a>
                  )}
                </div>
                <span className="t mono">{l.time.toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lp-panel">
          <h3>İnceleme raporu {repoMeta && <span className="mono muted">{repoMeta.name}</span>}</h3>
          {result && <Score result={result} />}
          {findings.length === 0 && !result && <div className="muted">Ajan aldığı her hizmetin sonucunu buraya yazacak.</div>}
          {findings.map((f) => (
            <div key={f.station} className="lp-find">
              <div className="h">{STATIONS[f.station]?.icon} {STATIONS[f.station]?.label}</div>
              {f.items.map((it, i) => (
                <div key={i} className={`it ${it.level}`}>
                  <span>{{ ok: "✓", warn: "!", bad: "✕", tip: "→" }[it.level]}</span> {it.text}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <footer className="lp-foot">
        Vault <a className="mono" href={`${dep.explorer}/address/${dep.address}`} target="_blank" rel="noreferrer">{dep.address}</a> · Monad Testnet
      </footer>
    </div>
  );
}

function Stat({ label, value, children }) {
  return (
    <div className="lp-stat">
      <label>{label}</label>
      <div className="v">{value}</div>
      {children}
    </div>
  );
}

function Station({ k, s, st }) {
  const state = st?.state || "idle";
  return (
    <div className={`lp-station s-${state} k-${k}`} style={{ left: `${s.x}%`, top: `${s.y}%` }}>
      <div className="ico">{s.icon}</div>
      <div className="txt">
        <div className="lb">{s.label}</div>
        <div className="sb">{s.sub}</div>
      </div>
      <div className="price">{s.price === "ücretsiz" ? s.price : `${s.price} MON`}</div>
      {(state === "paid" || state === "done") && <div className="badge ok">{st.ms ? `✓ ${st.ms} ms` : "✓ tarandı"}</div>}
      {state === "blocked" && <div className="badge bad">⛔ {REASONS[st.reason]?.split(" ").slice(0, 3).join(" ") || "engellendi"}</div>}
      {state === "paying" && <div className="badge pay">zincire yazılıyor…</div>}
    </div>
  );
}

function Coin({ c, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    const anim = ref.current.animate(
      [
        { left: `${c.from.x}%`, top: `${c.from.y}%`, transform: "translate(-50%,-50%) scale(.6)", opacity: 0 },
        { opacity: 1, offset: 0.15 },
        { left: `${(c.from.x + c.to.x) / 2}%`, top: `${Math.min(c.from.y, c.to.y) - 8}%`, transform: "translate(-50%,-50%) scale(1.15)", offset: 0.5 },
        { left: `${c.to.x}%`, top: `${c.to.y}%`, transform: "translate(-50%,-50%) scale(.7)", opacity: 0.2 },
      ],
      { duration: 900, easing: "cubic-bezier(.3,.7,.3,1)" }
    );
    anim.onfinish = onDone;
    return () => anim.cancel();
  }, []);
  return <div ref={ref} className="lp-coin">◆<small>{c.amount}</small></div>;
}

function Score({ result }) {
  const s = result.score;
  const color = s >= 80 ? "#2ee59d" : s >= 55 ? "#ffb547" : "#ff4d6d";
  return (
    <div className="lp-score">
      <div className="ring" style={{ background: `conic-gradient(${color} ${s * 3.6}deg, #241c45 0)` }}>
        <div><b>{s}</b><small>/100</small></div>
      </div>
      <div>
        <div className="big">Proje sağlık puanı</div>
        <div className="muted">
          {result.paid} hizmet satın alındı · {result.spent} MON harcandı · <span className="r">{result.blocked} deneme engellendi</span>
        </div>
      </div>
    </div>
  );
}

function Skyline() {
  const b = useMemo(() => {
    const out = [];
    let x = 0;
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    while (x < 1200) {
      const w = 26 + rnd() * 50;
      const h = 40 + rnd() * 130;
      const wins = [];
      for (let wy = 10; wy < h - 8; wy += 14)
        for (let wx = 6; wx < w - 8; wx += 11) if (rnd() > 0.62) wins.push([wx, wy]);
      out.push({ x, w, h, wins, tower: rnd() > 0.9 });
      x += w + 4 + rnd() * 10;
    }
    return out;
  }, []);
  return (
    <svg className="lp-skyline" viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice">
      {b.map((r, i) => (
        <g key={i} transform={`translate(${r.x},${200 - r.h})`}>
          <rect width={r.w} height={r.h} rx="2" />
          {r.tower && <rect x={r.w / 2 - 1.5} y={-24} width="3" height="24" />}
          {r.wins.map(([wx, wy], j) => (
            <rect key={j} className="w" x={wx} y={wy} width="5" height="6" style={{ animationDelay: `${(i * 7 + j) % 11}s` }} />
          ))}
        </g>
      ))}
    </svg>
  );
}
