import * as fs from 'fs';
import * as path from 'path';
import { HttpClient, HttpResponse } from './http';

/**
 * A local-file `HttpClient` used to run each adapter against the JSON
 * fixtures in `oracle/testdata/` without any network access.
 *
 * Upstream URLs are matched by their last path segment so the adapters can
 * run with `baseUrl` pointing at the fixture root (e.g. `file://fixtures`).
 */
export class FileHttpClient implements HttpClient {
  private readonly fixtureDir: string;

  constructor(fixtureDir = path.join(__dirname, 'testdata')) {
    this.fixtureDir = fixtureDir;
  }

  private resolve(url: string): HttpResponse<unknown> {
    const match = /projects\/[^/?]+(?:\/([\w-]+))?|\/ndvi\/stats|\/readings/.exec(url);
    if (!match) {
      return { status: 404, data: { error: `no fixture for ${url}` } };
    }

    let filename: string;
    if (url.includes('/ndvi/stats')) {
      filename = 'satellite-ndvi.json';
    } else if (url.includes('/readings')) {
      filename = 'iot-readings.json';
    } else if (match[1] === 'monitoring-reports') {
      filename = 'verra-monitoring-reports.json';
    } else {
      filename = 'verra-project.json';
    }

    const file = path.join(this.fixtureDir, filename);
    if (!fs.existsSync(file)) {
      return { status: 404, data: { error: `fixture not found: ${filename}` } };
    }
    return { status: 200, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }

  async get<T>(url: string): Promise<HttpResponse<T>> {
    return this.resolve(url) as HttpResponse<T>;
  }

  async post<T>(): Promise<HttpResponse<T>> {
    return { status: 404, data: undefined as unknown as T };
  }
}

import {
  pollVerraProject,
} from './verra-adapter';
import {
  ingestSatelliteMeasurement,
} from './satellite-processor';
import {
  aggregateIotProject,
} from './iot-aggregator';

const FILE_URL = 'file://fixtures';

async function runVerra(): Promise<void> {
  const report = await pollVerraProject(
    'VCS-1234',
    { periodStart: '2025-01-01', periodEnd: '2025-06-30' },
    { baseUrl: FILE_URL, http: new FileHttpClient() },
  );
  console.log(JSON.stringify(report, null, 2));
}

async function runSatellite(): Promise<void> {
  const report = await ingestSatelliteMeasurement(
    {
      project_id: 'VCS-1234',
      bbox: [-76.5, -6.2, -76.2, -5.9],
      area_ha: 1250,
      baseline_ndvi: 0.28,
    },
    { periodStart: '2025-01-01', periodEnd: '2025-03-31' },
    { baseUrl: FILE_URL, http: new FileHttpClient() },
  );
  console.log(JSON.stringify(report, null, 2));
}

async function runIot(): Promise<void> {
  const report = await aggregateIotProject(
    {
      project_id: 'VCS-1234',
      device_ids: ['NBS-SOIL-001', 'NBS-SOIL-002'],
      area_ha: 1250,
    },
    { periodStart: '2025-01-01', periodEnd: '2025-03-31' },
    { baseUrl: FILE_URL, http: new FileHttpClient() },
  );
  console.log(JSON.stringify(report, null, 2));
}

const ADAPTERS = { verra: runVerra, satellite: runSatellite, iot: runIot } as const;

async function main(): Promise<void> {
  const target = process.argv[2] ?? 'all';
  if (target === 'all') {
    for (const run of Object.values(ADAPTERS)) {
      await run();
      console.log('\n' + '─'.repeat(60) + '\n');
    }
    return;
  }
  const run = ADAPTERS[target as keyof typeof ADAPTERS];
  if (!run) {
    console.error(`Unknown adapter '${target}'. Expected one of: ${Object.keys(ADAPTERS).join(', ')}, all`);
    process.exit(1);
  }
  await run();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
