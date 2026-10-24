/**
 * Nansen API Multi-Key Pool & Auto-Rotation Manager
 * Location: src/utils/apiManager.ts
 */

function getEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key];
  }
  if (typeof (globalThis as any).Deno !== "undefined" && (globalThis as any).Deno.env) {
    return (globalThis as any).Deno.env.get(key);
  }
  return undefined;
}

// Define your key pool with active environment variables and demo fallback
const RAW_KEYS = [
  getEnv('NANSEN_API_KEY_2'),
  getEnv('NANSEN_API_KEY_3'),
  getEnv('NANSEN_API_KEY')
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

  get currentKey(): string {
    return API_KEY_POOL[this.currentIndex];
  }

  get currentIndexValue(): number {
    return this.currentIndex;
  }

  get totalKeys(): number {
    return API_KEY_POOL.length;
  }

  get maskedCurrentKey(): string {
    const key = this.currentKey;
    if (!key) return "NONE";
    if (key.length <= 8) return key.slice(0, 3) + "***";
    return key.slice(0, 4) + "..." + key.slice(-4);
  }

  private listeners: Array<() => void> = [];

  onRotate(fn: () => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  rotate() {
    this.currentIndex = (this.currentIndex + 1) % API_KEY_POOL.length;
    console.log(`Key exhausted. Rotating to key index: ${this.currentIndex}`);
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // Safe fallback
      }
    });
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
        console.warn(`API returned ${response.status}. Rotating key...`);
        keyManager.rotate();
        continue; 
      }

      // Otherwise, throw error for other status codes
      throw new Error(`Nansen API Error: ${response.status} - ${await response.text()}`);
    } catch (err: any) {
      if (i === retries - 1) {
        throw err;
      }
      console.warn(`Fetch error on attempt ${i + 1}: ${err.message}. Rotating key...`);
      keyManager.rotate();
    }
  }

  throw new Error('All API keys exhausted or failed.');
}

// Example implementation for your netflow calls
export async function fetchNetflows(params: any = {}) {
  const url = 'https://api.nansen.ai/v1/smart-money/netflow';
  
  // If in demo or simulated mode, return structured telemetry
  if (keyManager.currentKey.startsWith("demo_")) {
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
