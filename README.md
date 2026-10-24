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

## Network

Monad Testnet: chain id `10143`, RPC `https://testnet-rpc.monad.xyz`

Built at a Monad hackathon, 2026-10-24.
