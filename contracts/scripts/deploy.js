// Deploys MonAgentVault to Monad testnet AND prepares the live demo:
//  - creates a fresh agent wallet (key saved to agent/.env, never committed)
//  - creates demo vendor addresses
//  - deposits MON, registers the agent with a policy, funds agent gas
//  - writes deployment.json for the frontend and the agent
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const { ethers } = hre;
const env = (k, d) => process.env[k] || d;

async function main() {
  const [owner] = await ethers.getSigners();
  if (!owner) throw new Error("PRIVATE_KEY missing in contracts/.env");

  const bal = await ethers.provider.getBalance(owner.address);
  console.log(`Owner:   ${owner.address}`);
  console.log(`Balance: ${ethers.formatEther(bal)} MON\n`);

  // 1) Deploy
  const Vault = await ethers.getContractFactory("MonAgentVault");
  const vault = await Vault.deploy();
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  const deployTx = vault.deploymentTransaction();
  const receipt = await deployTx.wait();
  console.log(`✅ MonAgentVault deployed: ${address} (block ${receipt.blockNumber})`);

  // 2) Demo wallets
  const agentWallet = ethers.Wallet.createRandom();
  const vendors = {
    WeatherAPI: ethers.Wallet.createRandom().address,
    GPUCompute: ethers.Wallet.createRandom().address,
    TranslateAI: ethers.Wallet.createRandom().address,
    ShadyDataBroker: ethers.Wallet.createRandom().address, // NOT allowlisted
  };
  const allowed = [vendors.WeatherAPI, vendors.GPUCompute, vendors.TranslateAI];

  // 3) Deposit + register agent + fund agent gas
  const deposit = ethers.parseEther(env("DEMO_DEPOSIT", "0.5"));
  const maxPerTx = ethers.parseEther(env("DEMO_MAX_PER_TX", "0.05"));
  const daily = ethers.parseEther(env("DEMO_DAILY_LIMIT", "0.15"));
  const agentGas = ethers.parseEther(env("DEMO_AGENT_GAS", "0.1"));

  await (await vault.deposit({ value: deposit })).wait();
  console.log(`✅ Deposited ${ethers.formatEther(deposit)} MON into vault`);

  await (await vault.registerAgent(agentWallet.address, "ResearchBot-01", maxPerTx, daily, allowed)).wait();
  console.log(`✅ Agent registered: ${agentWallet.address}`);
  console.log(`   max/tx ${ethers.formatEther(maxPerTx)} MON, daily ${ethers.formatEther(daily)} MON`);

  await (await owner.sendTransaction({ to: agentWallet.address, value: agentGas })).wait();
  console.log(`✅ Sent ${ethers.formatEther(agentGas)} MON gas to agent wallet`);

  // 4) Write outputs
  const artifact = await hre.artifacts.readArtifact("MonAgentVault");
  const deployment = {
    network: "monadTestnet",
    chainId: 10143,
    rpcUrl: env("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz"),
    explorer: "https://testnet.monadexplorer.com",
    address,
    deployBlock: receipt.blockNumber,
    owner: owner.address,
    agent: agentWallet.address,
    vendors,
    abi: artifact.abi,
  };

  const root = path.join(__dirname, "..", "..");
  const targets = [
    path.join(root, "frontend", "src", "deployment.json"),
    path.join(root, "agent", "deployment.json"),
  ];
  for (const t of targets) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, JSON.stringify(deployment, null, 2));
    console.log(`📝 wrote ${path.relative(root, t)}`);
  }

  const agentEnv = path.join(root, "agent", ".env");
  fs.writeFileSync(agentEnv, `AGENT_PRIVATE_KEY=${agentWallet.privateKey}\n`);
  console.log(`🔑 wrote agent/.env (agent key, gitignored)`);

  console.log(`\nExplorer: ${deployment.explorer}/address/${address}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
