import { checkAdapterHealth, runHealthChecks } from './health';
import { MockHttpClient } from './test-helpers';

const CONFIG = { adapter: 'verra', url: 'https://registry.verra.org/api/v1' };

describe('checkAdapterHealth', () => {
  it('reports up for a fast 2xx probe', async () => {
    const http = new MockHttpClient([{ status: 200, data: { ok: true } }]);
    const result = await checkAdapterHealth(CONFIG, { http });

    expect(result.adapter).toBe('verra');
    expect(result.status).toBe('up');
    expect(result.error).toBeUndefined();
    expect(http.calls[0].url).toBe('https://registry.verra.org/api/v1/health');
  });

  it('reports degraded when latency exceeds the threshold', async () => {
    const http = new MockHttpClient([{ status: 200, data: { ok: true } }]);
    const started = Date.now();
    Date.now = jest
      .fn()
      .mockReturnValueOnce(started)
      .mockReturnValueOnce(started + 10_000);

    const result = await checkAdapterHealth(CONFIG, {
      http,
      latencyThresholdMs: 5_000,
    });

    expect(result.status).toBe('degraded');
    expect(result.error).toContain('exceeds threshold');
  });

  it('reports degraded for a 4xx upstream', async () => {
    const http = new MockHttpClient([{ status: 404, data: { error: 'not found' } }]);
    const result = await checkAdapterHealth(CONFIG, { http });
    expect(result.status).toBe('degraded');
    expect(result.error).toContain('404');
  });

  it('reports down for a 5xx upstream', async () => {
    const http = new MockHttpClient([{ status: 503, data: { error: 'unavailable' } }]);
    const result = await checkAdapterHealth(CONFIG, { http });
    expect(result.status).toBe('down');
  });

  it('reports down when the probe throws (network error)', async () => {
    const http = new MockHttpClient([new Error('ECONNREFUSED')]);
    const result = await checkAdapterHealth(CONFIG, { http });
    expect(result.status).toBe('down');
    expect(result.error).toContain('ECONNREFUSED');
  });
});

describe('runHealthChecks', () => {
  it('returns one result per adapter', async () => {
    const http = new MockHttpClient([
      { status: 200, data: {} },
      { status: 200, data: {} },
    ]);
    const results = await runHealthChecks(
      [
        { adapter: 'verra', url: 'https://registry.verra.org/api/v1' },
        { adapter: 'satellite', url: 'https://api.satellite-processor.io/v1' },
      ],
      { http },
    );

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.adapter)).toEqual(['verra', 'satellite']);
    expect(results.every((result) => result.status === 'up')).toBe(true);
  });
});
