// Allowlists the code-review service vendors for the CURRENT agent (deployment.json "agent")
// without registering a new agent. Cheap: only owner setVendor txs.
//   npx hardhat run scripts/add-services.js --network monadTestnet
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = hre;

async function main() {
  const root = path.join(__dirname, "..", "..");
  const files = [path.join(root, "frontend", "src", "deployment.json"), path.join(root, "agent", "deployment.json")];
  const dep = JSON.parse(fs.readFileSync(files[1]));
  const [owner] = await ethers.getSigners();
  const vault = await ethers.getContractAt("MonAgentVault", dep.address, owner);

  for (const svc of ["FrontendReviewer", "BackendAuditor", "SecurityScanner", "CodeImprover"]) {
    if (!dep.vendors[svc]) dep.vendors[svc] = ethers.Wallet.createRandom().address;
    if (!(await vault.isVendorAllowed(dep.agent, dep.vendors[svc]))) {
      await (await vault.setVendor(dep.agent, dep.vendors[svc], true)).wait();
    }
    console.log(`✅ ${svc} allowed for agent ${dep.agent.slice(0, 10)}…`);
  }
  for (const f of files) fs.writeFileSync(f, JSON.stringify(dep, null, 2));
  console.log("📝 deployment.json updated. Restart: npm run server (agent) and npm run dev (frontend).");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
