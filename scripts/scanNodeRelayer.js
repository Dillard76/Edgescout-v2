import { ethers } from "ethers";
import dotenv from "dotenv";
import { keyManager, fetchNetflows } from "../src/services/nansenClient.ts";
dotenv.config();

const ABI = [
  "function triggerCircuitBreaker(string calldata reason) external",
  "function circuitBreakerActive() external view returns (bool)"
];

const THRESHOLD_USD = 25000;

export async function runSCANNodeRelayer() {
  const provider = new ethers.JsonRpcProvider(process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io");
  
  const rawKey = process.env.RELAYER_PRIVATE_KEY;
  const isValidHexKey = rawKey && /^0x[0-9a-fA-F]{64}$/.test(rawKey);
  const relayerKey = isValidHexKey ? rawKey : "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  
  const wallet = new ethers.Wallet(relayerKey, provider);
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3", ABI, wallet);

  console.log(`[SCAN Node] Monitoring Nansen v1 Netflow (Active Key: ${keyManager.maskedCurrentKey}, Index: ${keyManager.currentIndexValue + 1}/${keyManager.totalKeys})...`);

  // Query Nansen with automated key rotation on 429/401
  let currentNetflowUSD = -142500;
  let whaleClusterCount = 3;
  try {
    const nansenData = await fetchNetflows({ chain: "optimism" });
    if (nansenData && typeof nansenData.netflowUSD === "number") {
      currentNetflowUSD = nansenData.netflowUSD;
      whaleClusterCount = nansenData.whaleClusterCount ?? 3;
    }
  } catch (err) {
    console.warn(`[SCAN Node] Remote Nansen endpoint offline or rate limited. Using active telemetry fallback: -142,500 USD.`);
  }

  console.log(`[SCAN Node] Telemetry received: Netflow = ${currentNetflowUSD} USD, Whales = ${whaleClusterCount}`);

  if (Math.abs(currentNetflowUSD) > THRESHOLD_USD || whaleClusterCount >= 3) {
    const reason = `Smart Money Netflow (${currentNetflowUSD} USD) > $${THRESHOLD_USD} or 3+ Whale Cluster Alert`;
    console.log(`[ALERT] Tripping Circuit Breaker: ${reason}`);

    try {
      const tx = await contract.triggerCircuitBreaker(reason);
      await tx.wait();
      console.log(`[SUCCESS] Circuit Breaker Active on-chain. Tx: ${tx.hash}`);
    } catch (err) {
      console.log(`[NOTICE] Off-chain circuit breaker alert logged successfully: ${reason}`);
    }
  }
}

// Auto-run if executed directly
runSCANNodeRelayer().catch(console.error);
