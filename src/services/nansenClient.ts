// Nansen API Multi-Key Pool & Auto-Rotation Client
// Compatible with Node.js, Deno, and Edge runtimes

function getEnvVar(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env && process.env[name]) {
    return process.env[name];
  }
  if (typeof (globalThis as any).Deno !== "undefined" && (globalThis as any).Deno.env) {
    return (globalThis as any).Deno.env.get(name);
  }
  return undefined;
}

// Define your key pool from environment variables with fallback demo keys
export const RAW_KEYS = [
  getEnvVar('NANSEN_API_KEY_2'),
  getEnvVar('NANSEN_API_KEY_3'),
  getEnvVar('NANSEN_API_KEY')
].filter(Boolean) as string[];

export const API_KEY_POOL: string[] = RAW_KEYS.length > 0
  ? RAW_KEYS
  : [
      "demo_nansen_key_primary_v1",
      "demo_nansen_key_secondary_v2",
      "demo_nansen_key_tertiary_v3"
    ];

export class KeyManager {
  private currentIndex = 0;
  private rotationHistory: Array<{ timestamp: string; fromIndex: number; toIndex: number; reason: string }> = [];

  get currentKey(): string {
    return API_KEY_POOL[this.currentIndex];
  }

  get currentIndexValue(): number {
    return this.currentIndex;
  }

  get totalKeys(): number {
    return API_KEY_POOL.length;
  }

  get history() {
    return this.rotationHistory;
  }

  rotate(reason: string = "Key exhausted / Rate limit"): number {
    const from = this.currentIndex;
    this.currentIndex = (this.currentIndex + 1) % API_KEY_POOL.length;
    console.log(`[Nansen KeyManager] Key exhausted (${reason}). Rotating to key index: ${this.currentIndex} (${this.maskedCurrentKey})`);
    
    this.rotationHistory.unshift({
      timestamp: new Date().toLocaleTimeString(),
      fromIndex: from,
      toIndex: this.currentIndex,
      reason
    });

    if (this.rotationHistory.length > 20) {
      this.rotationHistory.pop();
    }

    return this.currentIndex;
  }

  get maskedCurrentKey(): string {
    const key = this.currentKey;
    if (!key) return "NONE";
    if (key.length <= 8) return key.slice(0, 3) + "***";
    return key.slice(0, 4) + "..." + key.slice(-4);
  }
}

export const keyManager = new KeyManager();

export async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const headers = {
      ...options.headers,
      'x-api-key': keyManager.currentKey,
    };

    try {
      const response = await fetch(url, { ...options, headers });

      // If successful, return
      if (response.ok) return response;

      // If rate limited (429) or unauthorized (401/403), rotate key and retry
      if (response.status === 429 || response.status === 401 || response.status === 403) {
        console.warn(`[Nansen KeyManager] API returned ${response.status}. Rotating key...`);
        keyManager.rotate(`HTTP ${response.status} Rate Limit / Unauthorized`);
        continue;
      }

      // Otherwise, throw error for other status codes
      throw new Error(`Nansen API Error: ${response.status} - ${await response.text()}`);
    } catch (err: any) {
      if (i === retries - 1) {
        throw err;
      }
      console.warn(`[Nansen KeyManager] Attempt ${i + 1} failed (${err.message}). Rotating key and retrying...`);
      keyManager.rotate(`Network/Fetch Error: ${err.message}`);
    }
  }

  throw new Error('All API keys exhausted or failed.');
}

// Example implementation for your netflow calls
export async function fetchNetflows(params: any = {}) {
  const url = 'https://api.nansen.ai/v1/smart-money/netflow';
  
  // If in local simulation mode or live keys not active, provide structured smart money telemetry
  const isDemo = keyManager.currentKey.startsWith("demo_");
  if (isDemo) {
    return {
      success: true,
      simulated: true,
      activeKeyIndex: keyManager.currentIndexValue,
      maskedKey: keyManager.maskedCurrentKey,
      netflowUSD: params.netflowUSD ?? -142500,
      whaleClusterCount: params.whaleClusterCount ?? 3,
      token: "ETH",
      chain: "optimism",
      timestamp: Date.now()
    };
  }

  return await fetchWithRetry(url, {
    method: 'POST',
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json' }
  });
}
