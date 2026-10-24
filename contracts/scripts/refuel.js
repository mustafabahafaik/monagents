// Refuels the CURRENT agent using MON already sitting in the vault:
//  1) owner withdraws a little MON from the vault
//  2) sends it to the agent as gas
//  3) raises the agent's daily limit so a fresh review fits
//   npx hardhat run scripts/refuel.js --network monadTestnet
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = hre;
const F = (v) => Number(ethers.formatEther(v)).toFixed(4);

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "agent", "deployment.json")));
  const [owner] = await ethers.getSigners();
  const vault = await ethers.getContractAt("MonAgentVault", dep.address, owner);
  const agent = dep.agent;

  const ownerBal = await ethers.provider.getBalance(owner.address);
  const vaultBal = await vault.balanceOf(owner.address);
  const agentGas = await ethers.provider.getBalance(agent);
  const a = await vault.agents(agent);
  const left = await vault.remainingToday(agent);
  console.log(`owner wallet ${F(ownerBal)} MON | vault ${F(vaultBal)} MON | agent gas ${F(agentGas)} MON | agent left today ${F(left)} MON`);

  const gasTarget = ethers.parseEther(process.env.REFUEL_GAS || "0.5");
  const need = agentGas >= gasTarget ? 0n : gasTarget - agentGas;
  if (need > 0n) {
    if (vaultBal < need + ethers.parseEther("0.12")) {
      console.log(`⚠️  vault will have < 0.12 MON left for service payments after refuel`);
    }
    if (ownerBal < need) {
      const w = vaultBal < need ? vaultBal : need;
      await (await vault.withdraw(w)).wait();
      console.log(`✅ withdrew ${F(w)} MON from vault to owner`);
    }
    await (await owner.sendTransaction({ to: agent, value: need })).wait();
    console.log(`✅ sent ${F(need)} MON gas to agent`);
  } else {
    console.log("✓ agent gas OK");
  }

  // keep the vault stocked so service payments never fail on VAULT_INSUFFICIENT
  const vaultTarget = ethers.parseEther(process.env.REFUEL_VAULT || "1");
  const vaultNow = await vault.balanceOf(owner.address);
  if (vaultNow < vaultTarget) {
    const ob = await ethers.provider.getBalance(owner.address);
    const reserve = ethers.parseEther("0.05");
    let dep = vaultTarget - vaultNow;
    if (dep > ob - reserve) dep = ob > reserve ? ob - reserve : 0n;
    if (dep > 0n) {
      await (await vault.deposit({ value: dep })).wait();
      console.log(`✅ deposited ${F(dep)} MON into vault`);
    } else {
      console.log("⚠️  owner wallet too low to refill vault");
    }
  }

  const freeTarget = ethers.parseEther(process.env.REFUEL_DAILY || "0.5");
  if (left < freeTarget) {
    const spent = a.dailyLimit > left ? a.dailyLimit - left : 0n;
    const newDaily = spent + freeTarget;
    await (await vault.updatePolicy(agent, a.maxPerTx, newDaily)).wait();
    console.log(`✅ daily limit raised to ${F(newDaily)} MON (${F(freeTarget)} MON free today)`);
  }

  console.log(`\nowner ${F(await ethers.provider.getBalance(owner.address))} | vault ${F(await vault.balanceOf(owner.address))} | agent gas ${F(await ethers.provider.getBalance(agent))}`);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exitCode = 1;
});
