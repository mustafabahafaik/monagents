// Registers a FRESH demo agent on the existing vault (fresh daily limit),
// funds its gas and points agent/.env + deployment.json to it.
// Use this before re-running the demo:  npx hardhat run scripts/new-agent.js --network monadTestnet
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const { ethers } = hre;
const env = (k, d) => process.env[k] || d;

async function main() {
  const root = path.join(__dirname, "..", "..");
  const files = [path.join(root, "frontend", "src", "deployment.json"), path.join(root, "agent", "deployment.json")];
  const dep = JSON.parse(fs.readFileSync(files[1]));
  const [owner] = await ethers.getSigners();
  const vault = await ethers.getContractAt("MonAgentVault", dep.address, owner);

  const n = (await vault.getOwnerAgents(owner.address)).length + 1;
  const name = `ResearchBot-${String(n).padStart(2, "0")}`;
  const agentWallet = ethers.Wallet.createRandom();
  const allowed = [dep.vendors.WeatherAPI, dep.vendors.GPUCompute, dep.vendors.TranslateAI];

  const bal = await vault.balanceOf(owner.address);
  const min = ethers.parseEther("0.2");
  if (bal < min) {
    await (await vault.deposit({ value: min - bal })).wait();
    console.log(`✅ Topped up vault to 0.2 MON`);
  }

  await (
    await vault.registerAgent(
      agentWallet.address,
      name,
      ethers.parseEther(env("DEMO_MAX_PER_TX", "0.05")),
      ethers.parseEther(env("DEMO_DAILY_LIMIT", "0.15")),
      allowed
    )
  ).wait();
  console.log(`✅ Registered ${name}: ${agentWallet.address}`);

  await (await owner.sendTransaction({ to: agentWallet.address, value: ethers.parseEther(env("DEMO_AGENT_GAS", "0.2")) })).wait();
  console.log(`✅ Sent ${env("DEMO_AGENT_GAS", "0.2")} MON gas to agent`);

  dep.agent = agentWallet.address;
  for (const f of files) fs.writeFileSync(f, JSON.stringify(dep, null, 2));
  fs.writeFileSync(path.join(root, "agent", ".env"), `AGENT_PRIVATE_KEY=${agentWallet.privateKey}\nAGENT_NAME=${name}\n`);
  console.log(`🔑 agent/.env now points to ${name}. Run: cd ../agent; npm run demo`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
