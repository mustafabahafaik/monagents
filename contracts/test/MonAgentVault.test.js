const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const E = (x) => ethers.parseEther(x);

describe("MonAgentVault", function () {
  let vault, owner, agent, vendor, shady, stranger;

  beforeEach(async () => {
    [owner, agent, vendor, shady, stranger] = await ethers.getSigners();
    vault = await (await ethers.getContractFactory("MonAgentVault")).deploy();
    await vault.deposit({ value: E("1") });
    await vault.registerAgent(agent.address, "bot", E("0.1"), E("0.25"), [vendor.address]);
  });

  it("pays an allowed vendor within limits", async () => {
    await expect(vault.connect(agent).pay(vendor.address, E("0.05"), "weather"))
      .to.emit(vault, "PaymentExecuted")
      .withArgs(owner.address, agent.address, vendor.address, E("0.05"), "weather");
    expect(await vault.balanceOf(owner.address)).to.equal(E("0.95"));
    expect(await vault.remainingToday(agent.address)).to.equal(E("0.2"));
  });

  it("blocks vendor not on allowlist", async () => {
    await expect(vault.connect(agent).pay(shady.address, E("0.01"), "x"))
      .to.emit(vault, "PaymentBlocked")
      .withArgs(owner.address, agent.address, shady.address, E("0.01"), "VENDOR_NOT_ALLOWED", "x");
    expect(await vault.balanceOf(owner.address)).to.equal(E("1"));
  });

  it("blocks over per-tx limit", async () => {
    await expect(vault.connect(agent).pay(vendor.address, E("0.2"), "big"))
      .to.emit(vault, "PaymentBlocked")
      .withArgs(owner.address, agent.address, vendor.address, E("0.2"), "EXCEEDS_PER_TX_LIMIT", "big");
  });

  it("blocks over daily limit and resets next day", async () => {
    await vault.connect(agent).pay(vendor.address, E("0.1"), "1");
    await vault.connect(agent).pay(vendor.address, E("0.1"), "2");
    await expect(vault.connect(agent).pay(vendor.address, E("0.1"), "3"))
      .to.emit(vault, "PaymentBlocked")
      .withArgs(owner.address, agent.address, vendor.address, E("0.1"), "EXCEEDS_DAILY_LIMIT", "3");
    await time.increase(24 * 60 * 60);
    await expect(vault.connect(agent).pay(vendor.address, E("0.1"), "4")).to.emit(vault, "PaymentExecuted");
  });

  it("owner can pause the agent", async () => {
    await vault.setActive(agent.address, false);
    await expect(vault.connect(agent).pay(vendor.address, E("0.01"), "x"))
      .to.emit(vault, "PaymentBlocked")
      .withArgs(owner.address, agent.address, vendor.address, E("0.01"), "AGENT_PAUSED", "x");
  });

  it("only owner can change policy", async () => {
    await expect(vault.connect(stranger).setActive(agent.address, false)).to.be.revertedWithCustomError(vault, "NotAgentOwner");
    await expect(vault.connect(agent).updatePolicy(agent.address, E("9"), E("9"))).to.be.revertedWithCustomError(vault, "NotAgentOwner");
  });

  it("unknown agent cannot pay", async () => {
    await expect(vault.connect(stranger).pay(vendor.address, E("0.01"), "x")).to.be.revertedWithCustomError(vault, "UnknownAgent");
  });

  it("owner can withdraw", async () => {
    await vault.withdraw(E("0.4"));
    expect(await vault.balanceOf(owner.address)).to.equal(E("0.6"));
    await expect(vault.withdraw(E("5"))).to.be.revertedWithCustomError(vault, "InsufficientBalance");
  });
});
