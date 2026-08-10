import { createAxiosHttpClient, HttpClient } from './http';

export type AdapterStatus = 'up' | 'degraded' | 'down';

export interface AdapterHealth {
  adapter: string;
  status: AdapterStatus;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

export interface HealthCheckConfig {
  adapter: string;
  url: string;
}

export interface HealthCheckOptions {
  http?: HttpClient;
  timeoutMs?: number;
  /** Latency above this (ms) downgrades an otherwise 2xx probe to `degraded`. */
  latencyThresholdMs?: number;
  /** Override the probe path appended to the adapter base URL. */
  healthPath?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_LATENCY_THRESHOLD_MS = 5_000;
const DEFAULT_HEALTH_PATH = '/health';

/**
 * Adapter endpoints derived from the same env vars the adapters themselves
 * read, so the health probe tracks the real upstream targets.
 */
export function defaultHealthChecks(): HealthCheckConfig[] {
  return [
    {
      adapter: 'verra',
      url: process.env.VERRA_REGISTRY_URL || 'https://registry.verra.org/api/v1',
    },
    {
      adapter: 'satellite',
      url: process.env.SATELLITE_API_URL || 'https://api.satellite-processor.io/v1',
    },
    {
      adapter: 'iot',
      url: process.env.IOT_API_URL || 'https://api.iot-sensor-network.io/v1',
    },
  ];
}

/**
 * Probe a single adapter's health endpoint.
 *
 * - 2xx within the latency budget  -> `up`
 * - 2xx slower than the budget     -> `degraded` (slow upstream)
 * - 4xx (reachable, erroring)      -> `degraded`
 * - 5xx / network / timeout        -> `down`
 */
export async function checkAdapterHealth(
  config: HealthCheckConfig,
  options: HealthCheckOptions = {},
): Promise<AdapterHealth> {
  const http = options.http ?? createAxiosHttpClient(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const path = options.healthPath ?? DEFAULT_HEALTH_PATH;
  const probeUrl = `${config.url.replace(/\/$/, '')}${path}`;
  const threshold = options.latencyThresholdMs ?? DEFAULT_LATENCY_THRESHOLD_MS;
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();

  try {
    const response = await http.get<unknown>(probeUrl, {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const latencyMs = Date.now() - startedAt;

    if (response.status >= 500) {
      return {
        adapter: config.adapter,
        status: 'down',
        latencyMs,
        checkedAt,
        error: `upstream returned status ${response.status}`,
      };
    }
    if (response.status >= 400) {
      return {
        adapter: config.adapter,
        status: 'degraded',
        latencyMs,
        checkedAt,
        error: `upstream returned status ${response.status}`,
      };
    }
    if (latencyMs > threshold) {
      return {
        adapter: config.adapter,
        status: 'degraded',
        latencyMs,
        checkedAt,
        error: `probe latency ${latencyMs}ms exceeds threshold ${threshold}ms`,
      };
    }
    return { adapter: config.adapter, status: 'up', latencyMs, checkedAt };
  } catch (error) {
    return {
      adapter: config.adapter,
      status: 'down',
      latencyMs: Date.now() - startedAt,
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Run a health probe against every configured adapter concurrently. */
export async function runHealthChecks(
  adapters: HealthCheckConfig[] = defaultHealthChecks(),
  options: HealthCheckOptions = {},
): Promise<AdapterHealth[]> {
  return Promise.all(adapters.map((config) => checkAdapterHealth(config, options)));
}
