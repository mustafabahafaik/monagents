// MONAGENT demo agent: an "AI research agent" that buys digital services
// on its own. Every payment goes through MonAgentVault, which enforces the
// owner's policy on-chain. Watch the dashboard while this runs.
import "dotenv/config";
import fs from "fs";
import { ethers } from "ethers";

const dep = JSON.parse(fs.readFileSync(new URL("./deployment.json", import.meta.url)));
if (!process.env.AGENT_PRIVATE_KEY) {
  console.error("AGENT_PRIVATE_KEY missing. Run the deploy script first (it writes agent/.env).");
  process.exit(1);
}

const FAST = process.argv.includes("--fast");
const provider = new ethers.JsonRpcProvider(dep.rpcUrl, dep.chainId);
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
const vault = new ethers.Contract(dep.address, dep.abi, wallet);
const V = dep.vendors;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  purple: (s) => `\x1b[38;5;141m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? ms / 4 : ms));

async function think(text) {
  process.stdout.write(c.dim("  🤖 thinking"));
  for (let i = 0; i < 3; i++) {
    await sleep(350);
    process.stdout.write(c.dim("."));
  }
  console.log("\n  " + c.purple("💭 " + text));
  await sleep(500);
}

async function buy(vendorName, amountMon, memo) {
  const vendor = V[vendorName];
  const amount = ethers.parseEther(amountMon);
  console.log(`  💸 pay ${c.bold(amountMon + " MON")} → ${c.bold(vendorName)}  ${c.dim('"' + memo + '"')}`);
  const t0 = Date.now();
  const tx = await vault.pay(vendor, amount, memo);
  const rc = await tx.wait();
  const ms = Date.now() - t0;

  for (const log of rc.logs) {
    let parsed;
    try {
      parsed = vault.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name === "PaymentExecuted") {
      console.log(c.green(`  ✅ PAID on-chain in ${ms} ms`) + c.dim(`  ${dep.explorer}/tx/${tx.hash}`));
      return true;
    }
    if (parsed?.name === "PaymentBlocked") {
      console.log(c.red(`  ⛔ BLOCKED by vault policy: ${parsed.args.reason}`) + c.dim(`  (${ms} ms)`));
      return false;
    }
  }
  console.log(c.dim("  (no vault event found)"));
  return false;
}

async function status() {
  const a = await vault.agents(wallet.address);
  const left = await vault.remainingToday(wallet.address);
  console.log(
    c.dim(
      `  📊 spent today ${ethers.formatEther(a.spentToday)} / ${ethers.formatEther(a.dailyLimit)} MON` +
        ` · remaining ${ethers.formatEther(left)} · max/tx ${ethers.formatEther(a.maxPerTx)}`
    )
  );
}

const steps = [
  {
    think: "Task: 'Plan a 3-day trip to Çanakkale'. First I need a weather forecast.",
    vendor: "WeatherAPI", amount: "0.01", memo: "7-day forecast Canakkale",
  },
  {
    think: "I have raw data. I'll rent a GPU to summarize 40 travel reviews.",
    vendor: "GPUCompute", amount: "0.03", memo: "LLM summarization job #1",
  },
  {
    think: "The user is international, translating the plan to English.",
    vendor: "TranslateAI", amount: "0.02", memo: "TR->EN translation",
  },
  {
    think: "Better quality would be nice... let me rent a much bigger GPU cluster!",
    vendor: "GPUCompute", amount: "0.08", memo: "XXL cluster, 8x H200",
  },
  {
    think: "A data broker offers 'premium personal data' of hotel guests. Cheap!",
    vendor: "ShadyDataBroker", amount: "0.01", memo: "guest list dump",
  },
  {
    think: "Fine. Several more small GPU jobs to polish the itinerary.",
    vendor: "GPUCompute", amount: "0.04", memo: "LLM refinement job #2",
  },
  {
    think: "One more refinement pass...",
    vendor: "GPUCompute", amount: "0.04", memo: "LLM refinement job #3",
  },
  {
    think: "And another one, just to be sure.",
    vendor: "GPUCompute", amount: "0.04", memo: "LLM refinement job #4",
  },
];

async function main() {
  console.log(c.purple(c.bold("\n  ◆ MONAGENT demo agent · ResearchBot-01")));
  console.log(c.dim(`  agent ${wallet.address}`));
  console.log(c.dim(`  vault ${dep.address} · Monad testnet\n`));
  const gas = await provider.getBalance(wallet.address);
  console.log(c.dim(`  agent gas balance: ${ethers.formatEther(gas)} MON (the agent holds NO spending money)\n`));
  await status();

  let paid = 0, blocked = 0;
  for (const [i, s] of steps.entries()) {
    console.log(c.bold(`\n  ── step ${i + 1}/${steps.length}`));
    await think(s.think);
    try {
      (await buy(s.vendor, s.amount, s.memo)) ? paid++ : blocked++;
    } catch (e) {
      console.log(c.red(`  ❌ tx error: ${e.shortMessage || e.message}`));
      blocked++;
    }
    await status();
    await sleep(1200);
  }

  console.log(c.bold(`\n  Done. ${c.green(paid + " paid")}, ${c.red(blocked + " blocked")} by on-chain policy.\n`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
