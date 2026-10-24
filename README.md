<p align="center">
  <img src="frontend/public/mascot.png" width="120" alt="MONAGENT mascot" />
</p>

<h1 align="center">MONAGENT</h1>
<p align="center"><b>On-chain spending guardrails for AI agents on Monad.</b><br/>
Your AI agents buy services. Monad enforces the rules.</p>

<p align="center">
  <a href="https://monagent.onrender.com"><b>🌐 Live demo</b></a> ·
  <a href="https://testnet.monadexplorer.com/address/0x1C29D7da76a25b397736F3A8cFDAa2deFEFa2fC7"><b>📜 Contract on Monad Testnet</b></a>
</p>

---

## The problem

AI agents are starting to pay for things on their own: APIs, GPU time, data, other agents.
Today that means handing an agent a private key with a full wallet. One bug, one prompt injection, or one compromised server and the whole balance is gone.

## The solution

MONAGENT puts a smart-contract **vault** between the owner's money and the agent.

- The **owner** deposits MON into the vault and gives each agent a **policy**: max per transaction, daily budget and a vendor allowlist.
- The **agent wallet holds only gas**, never the funds. It calls `pay(vendor, amount, memo)`.
- The contract checks the policy **on-chain**. In-policy payments go through; out-of-policy payments are **blocked and recorded** as `PaymentBlocked(reason)`, so the owner sees every attempt, not just the successful ones.
- A **kill switch** pauses an agent instantly.

Even a fully compromised agent cannot spend more than its policy allows, because the rules live on Monad, not in the agent's code.

```
Owner ──deposit──▶ MonAgentVault (policy per agent) ──pay()──▶ Vendor
                         ▲                  │
AI agent ──pay(vendor, amount, memo)────────┘
(gas only)          ✅ PaymentExecuted   /   ⛔ PaymentBlocked(reason)
```

Policy checks, in order: `AGENT_PAUSED` → `VENDOR_NOT_ALLOWED` → `EXCEEDS_PER_TX_LIMIT` → `EXCEEDS_DAILY_LIMIT` → `VAULT_INSUFFICIENT`.

## Why Monad

Agents pay per request, which means many small transactions. Monad's throughput and ~sub-second confirmations make that practical: in our demo every agent payment is confirmed on-chain in **~0.6 s**, fast enough to sit inside an agent's normal request loop.

## Demo: send a project to the agent

On the landing page you enter a GitHub repo and press **"Projeyi ajana gönder"**. The agent:

1. **Scans the repo** through the GitHub API (free).
2. **Buys review services through the vault**, each one a real Monad transaction:
   | Service | Price | Result |
   |---|---|---|
   | 🎨 Frontend Reviewer | 0.02 MON | ✅ paid |
   | 🛠️ Backend Auditor | 0.03 MON | ✅ paid |
   | 🛡️ Security Scanner | 0.03 MON | ✅ paid |
   | 💎 Full AI Rewrite | 0.08 MON | ⛔ `EXCEEDS_PER_TX_LIMIT` |
   | 🕶️ ShadyDataBroker | 0.01 MON | ⛔ `VENDOR_NOT_ALLOWED` |
   | ✨ Code Improver | 0.04 MON | ✅ paid |
3. Builds a **health score and findings** from the real repo structure: UI tests, contract tests, CI, committed `.env` files, lockfiles, oversized components and more.

Everything is animated in a 3D scene: the mascot walks to each service, coins fly to the vendor, a worker mascot at each station does its job (scan beam, gears, paint), finding cards rise from the station, and blocked attempts make the worker refuse ✋.
The skyline features Ankara landmarks: Atakule, Anıtkabir and a sloped green-roof tower.

The **Dashboard** (`/#/dashboard`) is the owner's control panel: agents with spend bars, vendor allowlists, policy editing, deposit/withdraw, the kill switch and a live on-chain activity feed.

## Deployed on Monad Testnet

| | Address |
|---|---|
| MonAgentVault | [`0x1C29D7da76a25b397736F3A8cFDAa2deFEFa2fC7`](https://testnet.monadexplorer.com/address/0x1C29D7da76a25b397736F3A8cFDAa2deFEFa2fC7) |
| Chain | Monad Testnet (chain id `10143`) |

## Repository layout

| Folder | What |
|---|---|
| `contracts/` | `MonAgentVault.sol`, tests, deploy and ops scripts (Hardhat) |
| `agent/` | `server.js`: the agent server (repo analysis + on-chain purchases, SSE stream, also serves the built UI); `agent.js`: CLI demo |
| `frontend/` | React + Vite + viem: animated landing page and owner dashboard |
| `render.yaml` | One-click deploy of the whole app to Render |
| `start-demo.ps1` | Starts agent server + dashboard locally on Windows |

## Run it locally

```bash
# 1. Contracts
cd contracts
npm install
npx hardhat test                                   # 8 tests
cp .env.example .env                               # PRIVATE_KEY = owner wallet
npx hardhat run scripts/deploy.js --network monadTestnet

# 2. Agent server
cd ../agent && npm install && npm run server       # http://localhost:8787

# 3. Dashboard
cd ../frontend && npm install && npm run dev       # http://localhost:5173
```

On Windows you can run steps 2 and 3 together with `powershell -ExecutionPolicy Bypass -File .\start-demo.ps1`, which opens `http://localhost:5555`.

### Ops scripts (`contracts/scripts`)

| Script | What it does |
|---|---|
| `deploy.js` | Deploys the vault, creates a demo agent and vendors, deposits, registers the agent, writes `deployment.json` |
| `new-agent.js` | Registers a fresh agent (clean daily budget) with all service vendors allowlisted |
| `add-services.js` | Allowlists the review-service vendors for the current agent |
| `refuel.js` | Refills the vault and agent gas, reopens the daily budget before a demo |

Run each with `npx hardhat run scripts/<name> --network monadTestnet`.

## Tech stack

Solidity 0.8.24 · Hardhat · ethers v6 · viem · React 18 · Vite · Node.js (SSE) · GitHub REST API · Monad Testnet

## Türkçe özet

MONAGENT, yapay zekâ ajanlarına **para harcama yetkisi** verirken kuralları **Monad zincirinde** uygulayan bir güvenlik katmanı. Para ajanın cebinde değil, kasada duruyor. Sahip işlem başı limit, günlük bütçe ve izinli satıcı listesi belirliyor. Ajan hacklense bile bu limitleri aşamaz. Kural dışı her deneme zincirde engelleniyor ve kayda geçiyor. Sahip tek tuşla ajanı durdurabiliyor.

Demoda bir GitHub projesi ajana gönderiliyor. Ajan Frontend, Backend, Security ve Code Improver hizmetlerini Monad üzerinden gerçek işlemlerle satın alıyor. Pahalı "Full AI Rewrite" ve şüpheli satıcı ise kontrat tarafından reddediliyor. Bütün akış maskotlu 3D bir sahnede canlı izleniyor.

---

Built at a Monad hackathon on 2026-10-24 by [Mustafa Baha Faik](https://github.com/mustafabahafaik).
