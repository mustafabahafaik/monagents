// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MonAgentVault
/// @notice Owners deposit MON and give AI agents a spending policy.
///         Agents pay vendors through the vault; every payment is checked
///         against the policy on-chain. Out-of-policy payments are NOT reverted
///         but recorded as `PaymentBlocked`, so the owner sees every attempt.
contract MonAgentVault {
    struct Agent {
        address owner;
        string name;
        uint256 maxPerTx;
        uint256 dailyLimit;
        uint256 spentToday;
        uint256 dayStart;
        uint256 totalSpent;
        uint256 paymentCount;
        uint256 blockedCount;
        bool active;
    }

    mapping(address => uint256) public balanceOf; // owner => deposited MON
    mapping(address => Agent) public agents; // agent wallet => policy/state
    mapping(address => mapping(address => bool)) public isVendorAllowed; // agent => vendor => allowed

    mapping(address => address[]) private _ownerAgents;
    mapping(address => address[]) private _agentVendors;
    mapping(address => mapping(address => bool)) private _vendorKnown;

    bool private _locked;

    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event AgentRegistered(address indexed owner, address indexed agent, string name, uint256 maxPerTx, uint256 dailyLimit);
    event PolicyUpdated(address indexed owner, address indexed agent, uint256 maxPerTx, uint256 dailyLimit);
    event VendorSet(address indexed owner, address indexed agent, address indexed vendor, bool allowed);
    event AgentStatusChanged(address indexed owner, address indexed agent, bool active);
    event PaymentExecuted(address indexed owner, address indexed agent, address indexed vendor, uint256 amount, string memo);
    event PaymentBlocked(address indexed owner, address indexed agent, address indexed vendor, uint256 amount, string reason, string memo);

    error NotAgentOwner();
    error AgentAlreadyRegistered();
    error UnknownAgent();
    error InsufficientBalance();
    error TransferFailed();
    error ZeroAddress();
    error Reentrancy();

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    modifier onlyAgentOwner(address agent) {
        if (agents[agent].owner != msg.sender) revert NotAgentOwner();
        _;
    }

    // ------------------------------------------------------------------ vault

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    receive() external payable {
        deposit();
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ----------------------------------------------------------------- agents

    function registerAgent(
        address agent,
        string calldata name,
        uint256 maxPerTx,
        uint256 dailyLimit,
        address[] calldata vendors
    ) external {
        if (agent == address(0)) revert ZeroAddress();
        if (agents[agent].owner != address(0)) revert AgentAlreadyRegistered();

        Agent storage a = agents[agent];
        a.owner = msg.sender;
        a.name = name;
        a.maxPerTx = maxPerTx;
        a.dailyLimit = dailyLimit;
        a.dayStart = block.timestamp;
        a.active = true;
        _ownerAgents[msg.sender].push(agent);

        emit AgentRegistered(msg.sender, agent, name, maxPerTx, dailyLimit);

        for (uint256 i = 0; i < vendors.length; i++) {
            _setVendor(agent, vendors[i], true);
        }
    }

    function updatePolicy(address agent, uint256 maxPerTx, uint256 dailyLimit) external onlyAgentOwner(agent) {
        agents[agent].maxPerTx = maxPerTx;
        agents[agent].dailyLimit = dailyLimit;
        emit PolicyUpdated(msg.sender, agent, maxPerTx, dailyLimit);
    }

    function setVendor(address agent, address vendor, bool allowed) external onlyAgentOwner(agent) {
        _setVendor(agent, vendor, allowed);
    }

    function setActive(address agent, bool active) external onlyAgentOwner(agent) {
        agents[agent].active = active;
        emit AgentStatusChanged(msg.sender, agent, active);
    }

    function _setVendor(address agent, address vendor, bool allowed) internal {
        if (vendor == address(0)) revert ZeroAddress();
        if (!_vendorKnown[agent][vendor]) {
            _vendorKnown[agent][vendor] = true;
            _agentVendors[agent].push(vendor);
        }
        isVendorAllowed[agent][vendor] = allowed;
        emit VendorSet(agents[agent].owner, agent, vendor, allowed);
    }

    // --------------------------------------------------------------- payments

    /// @notice Called by the agent wallet. Returns true if paid, false if blocked by policy.
    function pay(address payable vendor, uint256 amount, string calldata memo) external nonReentrant returns (bool) {
        Agent storage a = agents[msg.sender];
        if (a.owner == address(0)) revert UnknownAgent();

        if (block.timestamp >= a.dayStart + 1 days) {
            a.dayStart = block.timestamp;
            a.spentToday = 0;
        }

        string memory reason = _check(a, msg.sender, vendor, amount);
        if (bytes(reason).length != 0) {
            a.blockedCount += 1;
            emit PaymentBlocked(a.owner, msg.sender, vendor, amount, reason, memo);
            return false;
        }

        a.spentToday += amount;
        a.totalSpent += amount;
        a.paymentCount += 1;
        balanceOf[a.owner] -= amount;

        (bool ok, ) = vendor.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit PaymentExecuted(a.owner, msg.sender, vendor, amount, memo);
        return true;
    }

    function _check(Agent storage a, address agent, address vendor, uint256 amount) internal view returns (string memory) {
        if (!a.active) return "AGENT_PAUSED";
        if (!isVendorAllowed[agent][vendor]) return "VENDOR_NOT_ALLOWED";
        if (amount > a.maxPerTx) return "EXCEEDS_PER_TX_LIMIT";
        if (a.spentToday + amount > a.dailyLimit) return "EXCEEDS_DAILY_LIMIT";
        if (balanceOf[a.owner] < amount) return "VAULT_INSUFFICIENT";
        return "";
    }

    // ------------------------------------------------------------------ views

    function getOwnerAgents(address owner) external view returns (address[] memory) {
        return _ownerAgents[owner];
    }

    function getAgentVendors(address agent) external view returns (address[] memory) {
        return _agentVendors[agent];
    }

    /// @notice What the agent can still spend today (accounts for day rollover).
    function remainingToday(address agent) external view returns (uint256) {
        Agent storage a = agents[agent];
        uint256 spent = block.timestamp >= a.dayStart + 1 days ? 0 : a.spentToday;
        return spent >= a.dailyLimit ? 0 : a.dailyLimit - spent;
    }
}
