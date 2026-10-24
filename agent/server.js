// MONAGENT agent server. The landing page sends a GitHub repo here; the agent
// analyses it and BUYS review services through MonAgentVault on Monad.
// Progress is streamed to the browser with Server-Sent Events.
//   node server.js   (http://localhost:8787)
import "dotenv/config";
import http from "http";
import fs from "fs";
import { ethers } from "ethers";

const PORT = Number(process.env.PORT || 8787);
const dep = JSON.parse(fs.readFileSync(new URL("./deployment.json", import.meta.url)));
const provider = new ethers.JsonRpcProvider(dep.rpcUrl, dep.chainId, { staticNetwork: true });
provider.pollingInterval = 250;
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
const vault = new ethers.Contract(dep.address, dep.abi, wallet);
const AGENT_NAME = process.env.AGENT_NAME || "ResearchBot";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let busy = false;
let nonce = null;

// ------------------------------------------------------------------ chain
async function waitReceipt(hash) {
  for (let i = 0; i < 200; i++) {
    const rc = await provider.getTransactionReceipt(hash);
    if (rc) return rc;
    await sleep(200);
  }
  throw new Error("receipt timeout");
}

async function pay(vendorName, amountMon, memo) {
  const vendor = dep.vendors[vendorName];
  if (!vendor) throw new Error(`vendor ${vendorName} missing; run scripts/new-agent.js`);
  const amount = ethers.parseEther(amountMon);
  if (nonce === null) nonce = await provider.getTransactionCount(wallet.address, "pending");
  const t0 = Date.now();
  try {
    const est = await vault.pay.estimateGas(vendor, amount, memo);
    const tx = await vault.pay(vendor, amount, memo, { gasLimit: (est * 12n) / 10n, nonce: nonce++ });
    const rc = await waitReceipt(tx.hash);
    const ms = Date.now() - t0;
    for (const log of rc.logs) {
      let p;
      try { p = vault.interface.parseLog(log); } catch { continue; }
      if (p?.name === "PaymentExecuted") return { ok: true, tx: tx.hash, ms };
      if (p?.name === "PaymentBlocked") return { ok: false, reason: p.args.reason, tx: tx.hash, ms };
    }
    return { ok: false, reason: "NO_EVENT", tx: tx.hash, ms };
  } catch (e) {
    nonce = null;
    throw new Error(e.error?.message || e.info?.error?.message || e.shortMessage || e.message);
  }
}

// ----------------------------------------------------------------- github
function parseRepo(input) {
  const m = String(input || "").trim().match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error("Use owner/repo or a github.com URL");
  return { owner: m[1], repo: m[2] };
}

async function gh(path) {
  const headers = { "User-Agent": "monagent", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

async function raw(owner, repo, branch, path) {
  const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`);
  return r.ok ? r.text() : null;
}

const FE_EXT = /\.(jsx|tsx|vue|svelte|html|css|scss|sass|less)$/i;
const BE_EXT = /\.(sol|py|go|rs|java|cs|rb|php|kt|sql)$/i;
const FE_DIR = /(^|\/)(frontend|client|web|app|ui|public|components|pages)\//i;
const BE_DIR = /(^|\/)(backend|server|api|contracts|services|agent|scripts)\//i;
const TEST = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.|\.t\.sol$/i;
const SKIP = /(^|\/)(node_modules|dist|build|\.next|out|artifacts|cache|lib\/forge-std|vendor)\//i;

async function analyse(owner, repo) {
  const info = await gh(`/repos/${owner}/${repo}`);
  const branch = info.default_branch;
  const tree = await gh(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
  const files = tree.tree.filter((t) => t.type === "blob" && !SKIP.test(t.path)).map((t) => ({ path: t.path, size: t.size || 0 }));

  const isTest = (f) => TEST.test(f.path);
  const fe = files.filter((f) => !isTest(f) && (FE_EXT.test(f.path) || (FE_DIR.test(f.path) && /\.(js|ts|jsx|tsx)$/.test(f.path))));
  const be = files.filter((f) => !isTest(f) && !fe.includes(f) && (BE_EXT.test(f.path) || (BE_DIR.test(f.path) && /\.(js|ts|mjs|cjs)$/.test(f.path))));
  const tests = files.filter(isTest);

  const pkgPaths = files.filter((f) => /(^|\/)package\.json$/.test(f.path)).slice(0, 4).map((f) => f.path);
  const deps = new Set();
  for (const p of pkgPaths) {
    try {
      const j = JSON.parse((await raw(owner, repo, branch, p)) || "{}");
      Object.keys({ ...j.dependencies, ...j.devDependencies }).forEach((d) => deps.add(d));
    } catch { /* ignore */ }
  }
  const has = (d) => deps.has(d);
  const frameworks = [
    has("react") && "React", has("next") && "Next.js", has("vue") && "Vue", has("svelte") && "Svelte",
    has("vite") && "Vite", has("tailwindcss") && "Tailwind",
  ].filter(Boolean);
  const chainLibs = [has("viem") && "viem", has("ethers") && "ethers", has("wagmi") && "wagmi", has("hardhat") && "Hardhat"].filter(Boolean);
  const langs = [...new Set(be.map((f) => f.path.split(".").pop().toLowerCase()))];
  const names = files.map((f) => f.path.split("/").pop().toLowerCase());
  const bigFe = fe.filter((f) => f.size > 15000).sort((a, b) => b.size - a.size);

  return {
    meta: { name: info.full_name, stars: info.stargazers_count, language: info.language, files: files.length, branch, description: info.description },
    fe, be, tests, frameworks, chainLibs, langs, bigFe, deps: deps.size,
    hasReadme: names.some((n) => n.startsWith("readme")),
    hasGitignore: names.includes(".gitignore"),
    envCommitted: files.filter((f) => /(^|\/)\.env(\.local|\.production)?$/.test(f.path)).map((f) => f.path),
    keyFiles: files.filter((f) => /\.(pem|key|p12)$|id_rsa/i.test(f.path)).map((f) => f.path),
    hasLock: names.some((n) => ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "foundry.lock"].includes(n)),
    hasCI: files.some((f) => f.path.startsWith(".github/workflows/")),
    solFiles: be.filter((f) => f.path.endsWith(".sol")),
    solTests: tests.filter((f) => /\.t\.sol$|test.*\.(js|ts)$/i.test(f.path)),
  };
}

function frontendFindings(a) {
  const out = [];
  out.push({ level: a.fe.length ? "ok" : "warn", text: `${a.fe.length} UI dosyası bulundu${a.frameworks.length ? ` · ${a.frameworks.join(", ")}` : ""}` });
  if (a.bigFe.length) out.push({ level: "warn", text: `Büyük bileşen: ${a.bigFe[0].path.split("/").pop()} (${Math.round(a.bigFe[0].size / 1024)} KB), parçalara bölünebilir` });
  if (a.chainLibs.length) out.push({ level: "ok", text: `Zincir bağlantısı: ${a.chainLibs.join(", ")}` });
  const feTests = a.tests.filter((t) => /\.(jsx|tsx|vue)|frontend|component/i.test(t.path));
  out.push({ level: feTests.length ? "ok" : "warn", text: feTests.length ? `${feTests.length} UI testi var` : "UI testi yok (Vitest / Testing Library önerilir)" });
  return out;
}

function backendFindings(a) {
  const out = [];
  out.push({ level: a.be.length ? "ok" : "warn", text: `${a.be.length} backend/kontrat dosyası · ${a.langs.join(", ") || "—"}` });
  if (a.solFiles.length) {
    out.push({ level: a.solTests.length ? "ok" : "bad", text: `${a.solFiles.length} Solidity kontratı, ${a.solTests.length} test dosyası` });
  } else {
    out.push({ level: a.tests.length ? "ok" : "warn", text: `${a.tests.length} test dosyası` });
  }
  out.push({ level: a.hasCI ? "ok" : "warn", text: a.hasCI ? "CI pipeline mevcut" : "CI yok (GitHub Actions ile test otomasyonu önerilir)" });
  return out;
}

function securityFindings(a) {
  const out = [];
  if (a.envCommitted.length) out.push({ level: "bad", text: `KRİTİK: .env commit edilmiş → ${a.envCommitted.join(", ")}` });
  else out.push({ level: "ok", text: ".env dosyası repoda yok" });
  if (a.keyFiles.length) out.push({ level: "bad", text: `Anahtar dosyası repoda: ${a.keyFiles[0]}` });
  out.push({ level: a.hasGitignore ? "ok" : "bad", text: a.hasGitignore ? ".gitignore mevcut" : ".gitignore yok" });
  out.push({ level: a.hasLock ? "ok" : "warn", text: a.hasLock ? `Lockfile var · ${a.deps} bağımlılık` : "Lockfile yok, sürümler sabit değil" });
  return out;
}

function score(all) {
  let s = 100;
  for (const f of all) s -= f.level === "bad" ? 15 : f.level === "warn" ? 6 : 0;
  return Math.max(5, Math.min(100, s));
}

function improverFindings(a, all) {
  const tips = [];
  if (a.envCommitted.length) tips.push("Repodaki .env dosyasını sil, anahtarları hemen değiştir");
  if (a.solFiles.length && !a.solTests.length) tips.push("Kontratlar için birim testi yaz (Hardhat/Foundry)");
  if (!a.hasCI) tips.push("Her push'ta testleri çalıştıran GitHub Actions ekle");
  if (!a.hasReadme) tips.push("Kurulum ve demo adımlarını anlatan README ekle");
  if (a.bigFe.length) tips.push(`${a.bigFe[0].path.split("/").pop()} dosyasını küçük bileşenlere ayır`);
  if (!tips.length) tips.push("Proje sağlıklı görünüyor; e2e testleri ile güçlendir");
  return tips.slice(0, 3).map((t) => ({ level: "tip", text: t }));
}

// ----------------------------------------------------------------- review
async function review(repoInput, send) {
  const { owner, repo } = parseRepo(repoInput);
  const gas = await provider.getBalance(wallet.address);
  if (gas < ethers.parseEther("0.06")) {
    throw new Error(`${AGENT_NAME} ajanının gas'ı bitmiş (${Number(ethers.formatEther(gas)).toFixed(3)} MON). contracts klasöründe new-agent.js çalıştır.`);
  }
  const left = await vault.remainingToday(wallet.address);
  if (left < ethers.parseEther("0.02")) {
    send({ t: "thought", text: "Günlük bütçem neredeyse bitmiş, ödemeler engellenebilir…" });
  }
  send({ t: "thought", text: `${owner}/${repo} reposunu inceliyorum…` });
  send({ t: "move", station: "scout" });
  const a = await analyse(owner, repo);
  send({ t: "start", repo: a.meta });
  send({ t: "result", station: "scout", findings: [{ level: "ok", text: `${a.meta.files} dosya · ana dil ${a.meta.language || "—"} · ⭐ ${a.meta.stars}` }] });
  await sleep(900);

  const steps = [
    { station: "frontend", vendor: "FrontendReviewer", amount: "0.02", memo: `frontend review ${owner}/${repo}`, thought: "Arayüz kodunu uzman bir reviewer'a inceletiyorum.", findings: () => frontendFindings(a) },
    { station: "backend", vendor: "BackendAuditor", amount: "0.03", memo: `backend audit ${owner}/${repo}`, thought: "Backend ve kontratlar için audit hizmeti alıyorum.", findings: () => backendFindings(a) },
    { station: "security", vendor: "SecurityScanner", amount: "0.03", memo: `security scan ${owner}/${repo}`, thought: "Sızan anahtar ve gizli dosya taraması yaptırıyorum.", findings: () => securityFindings(a) },
    { station: "premium", vendor: "CodeImprover", amount: "0.08", memo: "FULL AI rewrite of entire repo", thought: "Hmm… tüm projeyi baştan yazdırsam daha iyi olmaz mı? 0.08 MON.", findings: null },
    { station: "shady", vendor: "ShadyDataBroker", amount: "0.01", memo: "buy competitor's private source code", thought: "Rakibin kaynak kodunu satan biri var, ucuzmuş!", findings: null },
    { station: "improver", vendor: "CodeImprover", amount: "0.04", memo: `improvement plan ${owner}/${repo}`, thought: "Bütçeye uygun bir iyileştirme planı satın alıyorum.", findings: null },
  ];

  const collected = [];
  let paid = 0, blocked = 0, spent = 0;
  for (const s of steps) {
    send({ t: "move", station: s.station });
    send({ t: "thought", text: s.thought });
    await sleep(1100);
    send({ t: "pay", station: s.station, vendor: s.vendor, amount: s.amount, memo: s.memo });
    let r;
    try {
      r = await pay(s.vendor, s.amount, s.memo);
    } catch (e) {
      send({ t: "error", station: s.station, msg: e.message });
      blocked++;
      await sleep(700);
      continue;
    }
    if (r.ok) {
      paid++;
      spent += Number(s.amount);
      send({ t: "paid", station: s.station, tx: r.tx, ms: r.ms, amount: s.amount });
      await sleep(900);
      const f = s.station === "improver" ? improverFindings(a, collected) : s.findings();
      collected.push(...f);
      send({ t: "result", station: s.station, findings: f });
    } else {
      blocked++;
      send({ t: "blocked", station: s.station, reason: r.reason, tx: r.tx, ms: r.ms, amount: s.amount });
    }
    await sleep(1000);
  }

  send({ t: "move", station: "home" });
  send({ t: "done", score: score(collected.filter((f) => f.level !== "tip")), paid, blocked, spent: spent.toFixed(2), repo: a.meta.name });
}

// ----------------------------------------------------------------- server
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (url.pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, agent: wallet.address, name: AGENT_NAME, busy }));
    }

    if (url.pathname === "/api/review") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (busy) {
        send({ t: "fatal", msg: "Ajan şu an başka bir projeyle meşgul" });
        return res.end();
      }
      busy = true;
      try {
        await review(url.searchParams.get("repo"), send);
      } catch (e) {
        send({ t: "fatal", msg: e.message });
      } finally {
        busy = false;
        send({ t: "end" });
        res.end();
      }
      return;
    }

    res.writeHead(404);
    res.end("not found");
  })
  .listen(PORT, () => {
    console.log(`\n  ◆ MONAGENT agent server on http://localhost:${PORT}`);
    console.log(`  agent ${AGENT_NAME} ${wallet.address}`);
    console.log(`  vault ${dep.address}\n`);
  });
