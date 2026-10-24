# MONAGENT

**On-chain spending guardrails for AI agents on Monad.**

AI agents are starting to pay for things on their own: APIs, compute, data, other agents. Giving an agent a private key with a full wallet is dangerous. MONAGENT puts a smart-contract vault between the owner's funds and the agent:

- The owner deposits MON into a vault.
- Each agent gets a policy: **max per transaction**, **daily limit**, **allowed vendors**.
- The agent calls `pay(vendor, amount, memo)`. The contract enforces the policy, so an out-of-policy payment is **rejected on-chain** even if the agent is compromised.
- The owner can **pause** an agent instantly from the dashboard.

Monad's high throughput and low fees make per-request micro-payments by agents practical.

## Structure

| Folder | What |
|---|---|
| `contracts/` | Solidity vault + policy contract (Hardhat) |
| `agent/` | Demo AI agent script (Node + viem) that buys services through the vault |
| `frontend/` | Owner dashboard (React + Vite + viem) |

## How it works

```
Owner wallet ──deposit──▶ MonAgentVault (policy per agent) ──pay()──▶ Vendor
                               ▲                  │
AI agent wallet ──pay(vendor, amount, memo)───────┘
(holds only gas, never the funds)        ✅ PaymentExecuted  /  ⛔ PaymentBlocked(reason)
```

Policy checks, in order: `AGENT_PAUSED` → `VENDOR_NOT_ALLOWED` → `EXCEEDS_PER_TX_LIMIT` → `EXCEEDS_DAILY_LIMIT` → `VAULT_INSUFFICIENT`.
Blocked attempts are **recorded on-chain** instead of reverting, so the owner sees every attempt live.

## Run it

```bash
# 1. Contracts
cd contracts
npm install
npx hardhat test
cp .env.example .env        # put your PRIVATE_KEY
npx hardhat run scripts/deploy.js --network monadTestnet

# 2. Dashboard
cd ../frontend
npm install
npm run dev                 # http://localhost:5173

# 3. Agent (in a second terminal)
cd ../agent
npm install
npm run demo
```

The deploy script deploys the vault, creates a demo agent wallet and vendor addresses, deposits MON, registers the agent and writes `deployment.json` for the dashboard and the agent.

## Demo flow

1. Dashboard open, mascot "GUARDING".
2. `npm run demo`: the agent buys weather data, GPU time and translation → ✅ paid.
3. It tries an 8x GPU cluster → ⛔ `EXCEEDS_PER_TX_LIMIT`.
4. It tries a shady data broker → ⛔ `VENDOR_NOT_ALLOWED`.
5. It keeps spending → ⛔ `EXCEEDS_DAILY_LIMIT`.
6. Owner hits **Kill switch** → every further attempt ⛔ `AGENT_PAUSED`.

## Network

Monad Testnet: chain id `10143`, RPC `https://testnet-rpc.monad.xyz`

Built at a Monad hackathon, 2026-10-24.
