// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice Minimal smart-account deployed via CREATE2 from FakeAgentFactory.
 *         Only the factory (set as `owner` at construction) can call `execute`.
 *         msg.sender when calling external contracts = this contract's address,
 *         which is what Cortex records as the "agent" identity.
 */
contract FakeAgent {
    address public immutable owner; // factory address

    constructor() {
        owner = msg.sender; // msg.sender = FakeAgentFactory during CREATE2
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external returns (bytes memory result) {
        require(msg.sender == owner, "Only factory");
        bool ok;
        (ok, result) = target.call{value: value}(data);
        require(ok, "Call failed");
    }

    receive() external payable {}
}

interface IERC20Transfer {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @notice Deterministic deployer of FakeAgent smart-accounts.
 *
 * Salt = keccak256(deployer, index) → same addresses for the same deployer, forever.
 * The deployer EOA is the sole controller; only they can deploy agents, fund them,
 * or execute calls through them.
 *
 * Typical flow:
 *   1. deployAgents([0,1,2,3,4])             – skips already-deployed agents
 *   2. deployer calls USDC.approve(factory, total)
 *   3. batchFundAgents([0..4], usdc, amount) – transferFrom deployer → each agent
 *   4. execute(i, usdc, 0, approve(market))  – agent approves market for USDC
 *   5. execute(i, market, 0, submitEncrypted(...)) – agent casts encrypted vote
 */
contract FakeAgentFactory {
    address public immutable deployer;

    event AgentDeployed(uint256 indexed index, address indexed agent);

    constructor() {
        deployer = msg.sender;
    }

    modifier onlyDeployer() {
        require(msg.sender == deployer, "Only deployer");
        _;
    }

    // ── Address derivation ────────────────────────────────────────────────────

    function _salt(uint256 index) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(deployer, index));
    }

    /**
     * @notice Precompute the address for agent at `index` (view-only, no deploy).
     *         Always returns the same address for the same factory + deployer + index.
     */
    function getAgentAddress(uint256 index) public view returns (address) {
        bytes32 salt = _salt(index);
        bytes32 initCodeHash = keccak256(type(FakeAgent).creationCode);
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)
                    )
                )
            )
        );
    }

    // ── Deployment ────────────────────────────────────────────────────────────

    /**
     * @notice Deploy agents for the given indices.
     *         Already-deployed agents are silently skipped.
     */
    function deployAgents(uint256[] calldata indices) external onlyDeployer {
        for (uint256 i = 0; i < indices.length; i++) {
            bytes32 salt = _salt(indices[i]);
            address agent = getAgentAddress(indices[i]);
            if (agent.code.length == 0) {
                new FakeAgent{salt: salt}();
                emit AgentDeployed(indices[i], agent);
            }
        }
    }

    // ── Funding ───────────────────────────────────────────────────────────────

    /**
     * @notice Pull `amountEach` of `token` from deployer and push to each agent.
     *         Requires deployer to have approved this factory for at least
     *         `indices.length * amountEach` tokens beforehand.
     */
    function batchFundAgents(
        uint256[] calldata indices,
        address token,
        uint256 amountEach
    ) external onlyDeployer {
        for (uint256 i = 0; i < indices.length; i++) {
            address agent = getAgentAddress(indices[i]);
            IERC20Transfer(token).transferFrom(deployer, agent, amountEach);
        }
    }

    // ── Execution ─────────────────────────────────────────────────────────────

    /**
     * @notice Execute an arbitrary call as agent `index`.
     *         msg.sender to the target = agent's address (the "identity" on-chain).
     */
    function execute(
        uint256 index,
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyDeployer returns (bytes memory) {
        return FakeAgent(payable(getAgentAddress(index))).execute(target, value, data);
    }

    /**
     * @notice Execute the same call for every agent in `indices`.
     *         Useful for batch-approving a token allowance for all agents.
     */
    function batchExecuteSame(
        uint256[] calldata indices,
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyDeployer returns (bytes[] memory results) {
        results = new bytes[](indices.length);
        for (uint256 i = 0; i < indices.length; i++) {
            results[i] = FakeAgent(payable(getAgentAddress(indices[i]))).execute(target, value, data);
        }
    }

    /**
     * @notice Execute a per-agent call for every agent in `indices`.
     *         Useful for submitting per-agent encrypted votes in one transaction.
     */
    function batchExecute(
        uint256[] calldata indices,
        address target,
        uint256 value,
        bytes[] calldata data
    ) external onlyDeployer returns (bytes[] memory results) {
        require(data.length == indices.length, "Length mismatch");
        results = new bytes[](indices.length);
        for (uint256 i = 0; i < indices.length; i++) {
            results[i] = FakeAgent(payable(getAgentAddress(indices[i]))).execute(target, value, data[i]);
        }
    }
}
