import { createPublicClient, createWalletClient, custom, defineChain, http } from "viem";
import dep from "./deployment.json";

export { dep };

export const monad = defineChain({
  id: dep.chainId,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [dep.rpcUrl] } },
  blockExplorers: { default: { name: "Monad Explorer", url: dep.explorer } },
  testnet: true,
});

export const publicClient = createPublicClient({
  chain: monad,
  transport: http(dep.rpcUrl, { batch: { batchSize: 25, wait: 30 }, retryCount: 4, retryDelay: 400 }),
});

export async function connectWallet() {
  if (!window.ethereum) throw new Error("MetaMask not found");
  const wallet = createWalletClient({ chain: monad, transport: custom(window.ethereum) });
  const [account] = await wallet.requestAddresses();
  try {
    await wallet.switchChain({ id: monad.id });
  } catch {
    await wallet.addChain({ chain: monad });
    await wallet.switchChain({ id: monad.id });
  }
  return { wallet, account };
}

const vendorNames = Object.fromEntries(
  Object.entries(dep.vendors || {}).map(([name, addr]) => [addr.toLowerCase(), name])
);
export const vendorName = (addr) => vendorNames[addr?.toLowerCase()] || short(addr);
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

// Monad public RPC limits eth_getLogs to 100 blocks per call.
export async function fetchEvents(fromBlock, toBlock) {
  const out = [];
  const STEP = 100n;
  const ranges = [];
  for (let s = fromBlock; s <= toBlock; s += STEP) {
    const e = s + STEP - 1n > toBlock ? toBlock : s + STEP - 1n;
    ranges.push([s, e]);
  }
  for (let i = 0; i < ranges.length; i += 2) {
    const batch = ranges.slice(i, i + 2).map(([s, e]) =>
      publicClient.getContractEvents({ address: dep.address, abi: dep.abi, fromBlock: s, toBlock: e })
    );
    const results = await Promise.all(batch);
    results.forEach((r) => out.push(...r));
  }
  return out;
}
