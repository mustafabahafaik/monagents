import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther, parseEther } from "viem";
import { connectWallet, dep, fetchEvents, publicClient, short, vendorName } from "./chain.js";

const REASONS = {
  AGENT_PAUSED: "Agent paused by owner",
  VENDOR_NOT_ALLOWED: "Vendor not on allowlist",
  EXCEEDS_PER_TX_LIMIT: "Over per-transaction limit",
  EXCEEDS_DAILY_LIMIT: "Over daily limit",
  VAULT_INSUFFICIENT: "Vault balance too low",
};

const fmt = (v, d = 3) => Number(formatEther(v ?? 0n)).toFixed(d);
const read = (functionName, args = []) =>
  publicClient.readContract({ address: dep.address, abi: dep.abi, functionName, args });

export default function App() {
  const [account, setAccount] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [block, setBlock] = useState(null);
  const [vaultBal, setVaultBal] = useState(0n);
  const [agents, setAgents] = useState([]);
  const [feed, setFeed] = useState([]);
  const [mood, setMood] = useState("idle"); // idle | ok | blocked
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const lastBlock = useRef(null);
  const moodTimer = useRef(null);

  const viewOwner = dep.owner;
  const isOwner = !!account && account.toLowerCase() === dep.owner?.toLowerCase();

  const flash = (m) => {
    setMood(m);
    clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setMood("idle"), 1800);
  };

  // ---------------------------------------------------------------- state
  const refresh = useCallback(async () => {
    if (!dep.address || !viewOwner) return;
    const [bal, list] = await Promise.all([read("balanceOf", [viewOwner]), read("getOwnerAgents", [viewOwner])]);
    setVaultBal(bal);
    const rows = await Promise.all(
      list.map(async (addr) => {
        const [a, left, vendors] = await Promise.all([
          read("agents", [addr]),
          read("remainingToday", [addr]),
          read("getAgentVendors", [addr]),
        ]);
        const allowed = await Promise.all(vendors.map((v) => read("isVendorAllowed", [addr, v])));
        const [owner, name, maxPerTx, dailyLimit, spentToday, , totalSpent, paymentCount, blockedCount, active] = a;
        return {
          addr, owner, name, maxPerTx, dailyLimit, totalSpent, paymentCount, blockedCount, active,
          spentToday: dailyLimit - left > 0n ? dailyLimit - left : 0n,
          rawSpent: spentToday,
          vendors: vendors.map((v, i) => ({ addr: v, allowed: allowed[i] })),
        };
      })
    );
    setAgents(rows);
  }, [viewOwner]);

  // --------------------------------------------------------------- events
  const pollEvents = useCallback(async () => {
    if (!dep.address) return;
    const latest = await publicClient.getBlockNumber();
    setBlock(latest);
    let from;
    const initial = lastBlock.current === null;
    if (initial) {
      const start = BigInt(dep.deployBlock || 0);
      from = latest - 3000n > start ? latest - 3000n : start;
    } else {
      from = lastBlock.current + 1n;
    }
    if (from > latest) return;
    const logs = await fetchEvents(from, latest);
    lastBlock.current = latest;
    const items = logs
      .filter((l) => !l.args?.owner || l.args.owner.toLowerCase() === dep.owner?.toLowerCase())
      .map((l) => ({
        id: `${l.transactionHash}-${l.logIndex}`,
        type: l.eventName,
        args: l.args,
        block: l.blockNumber,
        tx: l.transactionHash,
        time: initial ? null : new Date(),
      }));
    if (!items.length) return;
    setFeed((f) => [...items.reverse(), ...f].slice(0, 80));
    if (!initial) {
      if (items.some((i) => i.type === "PaymentBlocked")) flash("blocked");
      else if (items.some((i) => i.type === "PaymentExecuted")) flash("ok");
      refresh();
    }
  }, [refresh]);

  useEffect(() => {
    if (!dep.address) return;
    refresh().catch(console.error);
    pollEvents().catch(console.error);
    const t1 = setInterval(() => pollEvents().catch(console.error), 1500);
    const t2 = setInterval(() => refresh().catch(console.error), 4000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [refresh, pollEvents]);

  // -------------------------------------------------------------- actions
  const onConnect = async () => {
    try {
      const { wallet, account } = await connectWallet();
      setWallet(wallet);
      setAccount(account);
    } catch (e) {
      setToast(e.shortMessage || e.message);
    }
  };

  const send = async (label, functionName, args = [], value) => {
    if (!wallet) return setToast("Connect the owner wallet first");
    try {
      setBusy(label);
      const hash = await wallet.writeContract({ address: dep.address, abi: dep.abi, functionName, args, account, value });
      await publicClient.waitForTransactionReceipt({ hash });
      setToast(`✓ ${label}`);
      await refresh();
    } catch (e) {
      setToast(e.shortMessage || e.message);
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!dep.address) {
    return (
      <div className="empty">
        <img src="/mascot.png" alt="" className="mascot small" />
        <h2>No deployment yet</h2>
        <p>Run <code>npx hardhat run scripts/deploy.js --network monadTestnet</code> in <code>contracts/</code>.</p>
      </div>
    );
  }

  const paidCount = agents.reduce((s, a) => s + Number(a.paymentCount), 0);
  const blockedCount = agents.reduce((s, a) => s + Number(a.blockedCount), 0);
  const spentTotal = agents.reduce((s, a) => s + a.totalSpent, 0n);

  return (
    <div className="app">
      <header>
        <div className="logo">
          <span className="diamond">◆</span> MONAGENT
        </div>
        <div className="net">
          <span className="dot" /> Monad Testnet {block !== null && <span className="mono">#{block.toString()}</span>}
        </div>
        {account ? (
          <div className="acct">
            <span className={isOwner ? "pill green" : "pill"}>{isOwner ? "OWNER" : "VIEWER"}</span>
            <span className="mono">{short(account)}</span>
          </div>
        ) : (
          <button className="btn primary" onClick={onConnect}>Connect wallet</button>
        )}
      </header>

      <section className="hero">
        <div className="stat">
          <label>Vault balance</label>
          <b>{fmt(vaultBal)} <small>MON</small></b>
        </div>
        <div className="stat">
          <label>Spent by agents</label>
          <b>{fmt(spentTotal)} <small>MON</small></b>
        </div>
        <div className={`mascot-wrap ${mood}`}>
          <div className="ring" />
          <div className="ring r2" />
          <img src="/mascot.png" alt="Monad mascot" className="mascot" />
          <div className="shield">{mood === "blocked" ? "⛔ BLOCKED" : mood === "ok" ? "✓ PAID" : "GUARDING"}</div>
        </div>
        <div className="stat">
          <label>Payments approved</label>
          <b className="green-t">{paidCount}</b>
        </div>
        <div className="stat">
          <label>Attempts blocked</label>
          <b className="red-t">{blockedCount}</b>
        </div>
      </section>
      <p className="tagline">Your AI agents spend. <span>Monad enforces the rules.</span></p>

      <main>
        <div className="col">
          <h3>Agents</h3>
          {agents.length === 0 && <div className="card muted">No agents registered.</div>}
          {agents.map((a) => (
            <AgentCard key={a.addr} a={a} isOwner={isOwner} busy={busy} send={send} />
          ))}

          <h3>Vault</h3>
          <VaultCard isOwner={isOwner} busy={busy} send={send} />
        </div>

        <div className="col">
          <h3>
            Live on-chain activity <span className="live">● LIVE</span>
          </h3>
          <div className="feed">
            {feed.length === 0 && <div className="card muted">Waiting for agent activity…</div>}
            {feed.map((e) => (
              <FeedItem key={e.id} e={e} />
            ))}
          </div>
        </div>
      </main>

      <footer>
        Contract{" "}
        <a href={`${dep.explorer}/address/${dep.address}`} target="_blank" rel="noreferrer" className="mono">
          {dep.address}
        </a>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function AgentCard({ a, isOwner, busy, send }) {
  const [edit, setEdit] = useState(false);
  const [maxTx, setMaxTx] = useState("");
  const [daily, setDaily] = useState("");
  const pct = a.dailyLimit > 0n ? Number((a.spentToday * 10000n) / a.dailyLimit) / 100 : 0;
  const barClass = pct >= 90 ? "bar red" : pct >= 60 ? "bar amber" : "bar";

  return (
    <div className={`card agent ${a.active ? "" : "paused"}`}>
      <div className="row">
        <div>
          <div className="name">🤖 {a.name}</div>
          <div className="mono muted">{short(a.addr)}</div>
        </div>
        <span className={a.active ? "pill green" : "pill red"}>{a.active ? "ACTIVE" : "PAUSED"}</span>
      </div>

      <div className="spend">
        <div className="row small">
          <span>Spent today</span>
          <span className="mono">
            {fmt(a.spentToday)} / {fmt(a.dailyLimit)} MON
          </span>
        </div>
        <div className="track">
          <div className={barClass} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      </div>

      <div className="grid3">
        <div><label>Max / tx</label><b>{fmt(a.maxPerTx)}</b></div>
        <div><label>Paid</label><b className="green-t">{a.paymentCount.toString()}</b></div>
        <div><label>Blocked</label><b className="red-t">{a.blockedCount.toString()}</b></div>
      </div>

      <div className="vendors">
        <label>Vendor allowlist</label>
        {a.vendors.map((v) => (
          <button
            key={v.addr}
            className={`chip ${v.allowed ? "on" : "off"}`}
            disabled={!isOwner || !!busy}
            title={isOwner ? "Click to toggle" : v.addr}
            onClick={() => send(`${v.allowed ? "Removed" : "Allowed"} ${vendorName(v.addr)}`, "setVendor", [a.addr, v.addr, !v.allowed])}
          >
            {v.allowed ? "✓" : "✕"} {vendorName(v.addr)}
          </button>
        ))}
      </div>

      {isOwner && (
        <div className="actions">
          <button
            className={a.active ? "btn danger" : "btn primary"}
            disabled={!!busy}
            onClick={() => send(a.active ? "Agent paused" : "Agent resumed", "setActive", [a.addr, !a.active])}
          >
            {busy === "Agent paused" || busy === "Agent resumed" ? "…" : a.active ? "⏸ Kill switch" : "▶ Resume"}
          </button>
          <button className="btn" onClick={() => setEdit(!edit)}>Edit policy</button>
        </div>
      )}

      {edit && (
        <div className="edit">
          <input placeholder={`max/tx (${fmt(a.maxPerTx)})`} value={maxTx} onChange={(e) => setMaxTx(e.target.value)} />
          <input placeholder={`daily (${fmt(a.dailyLimit)})`} value={daily} onChange={(e) => setDaily(e.target.value)} />
          <button
            className="btn primary"
            disabled={!!busy}
            onClick={() => {
              try {
                const m = maxTx ? parseEther(maxTx) : a.maxPerTx;
                const d = daily ? parseEther(daily) : a.dailyLimit;
                send("Policy updated", "updatePolicy", [a.addr, m, d]).then(() => setEdit(false));
              } catch {
                /* invalid number */
              }
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function VaultCard({ isOwner, busy, send }) {
  const [amt, setAmt] = useState("0.1");
  return (
    <div className="card">
      <div className="edit">
        <input value={amt} onChange={(e) => setAmt(e.target.value)} disabled={!isOwner} />
        <button className="btn primary" disabled={!isOwner || !!busy} onClick={() => send("Deposited", "deposit", [], parseEther(amt || "0"))}>
          Deposit
        </button>
        <button className="btn" disabled={!isOwner || !!busy} onClick={() => send("Withdrawn", "withdraw", [parseEther(amt || "0")])}>
          Withdraw
        </button>
      </div>
      {!isOwner && <div className="muted small">Connect the owner wallet to manage funds and policies.</div>}
    </div>
  );
}

function FeedItem({ e }) {
  const a = e.args || {};
  let icon = "•", cls = "", title = e.type, detail = "";
  switch (e.type) {
    case "PaymentExecuted":
      icon = "✅"; cls = "ok";
      title = `Paid ${fmt(a.amount, 3)} MON → ${vendorName(a.vendor)}`;
      detail = a.memo;
      break;
    case "PaymentBlocked":
      icon = "⛔"; cls = "bad";
      title = `Blocked ${fmt(a.amount, 3)} MON → ${vendorName(a.vendor)}`;
      detail = `${REASONS[a.reason] || a.reason} · "${a.memo}"`;
      break;
    case "AgentStatusChanged":
      icon = a.active ? "▶" : "⏸"; cls = a.active ? "" : "bad";
      title = a.active ? "Agent resumed by owner" : "KILL SWITCH: agent paused";
      break;
    case "PolicyUpdated":
      icon = "⚙"; title = "Policy updated";
      detail = `max/tx ${fmt(a.maxPerTx)} · daily ${fmt(a.dailyLimit)} MON`;
      break;
    case "AgentRegistered":
      icon = "🤖"; title = `Agent registered: ${a.name}`;
      detail = `max/tx ${fmt(a.maxPerTx)} · daily ${fmt(a.dailyLimit)} MON`;
      break;
    case "Deposited":
      icon = "⬇"; title = `Deposited ${fmt(a.amount)} MON`;
      break;
    case "Withdrawn":
      icon = "⬆"; title = `Withdrew ${fmt(a.amount)} MON`;
      break;
    case "VendorSet":
      icon = a.allowed ? "＋" : "－"; title = `${a.allowed ? "Allowed" : "Removed"} vendor ${vendorName(a.vendor)}`;
      break;
    default:
      break;
  }
  return (
    <a className={`item ${cls}`} href={`${dep.explorer}/tx/${e.tx}`} target="_blank" rel="noreferrer">
      <span className="icon">{icon}</span>
      <div className="body">
        <div className="title">{title}</div>
        {detail && <div className="detail">{detail}</div>}
      </div>
      <span className="when mono">{e.time ? e.time.toLocaleTimeString() : `#${e.block}`}</span>
    </a>
  );
}
