# Runbook: Degraded Oracle Providers

With staking and slashing live on `OracleConsumer`, the protocol has a real
economic stake in provider reliability. This runbook covers how to observe
provider health, what alerts mean, and how to respond.

## Observability surface

| Signal | Where | Description |
|--------|-------|-------------|
| Adapter health | `oracle` monitor, `GET /health` | Per-adapter upstream probe: `up` / `degraded` / `down` + latency |
| Report staleness | API, `GET /oracle/monitoring/staleness` | Per-project and per-provider time since last verified report vs. expected window |
| Provider stats | API, `GET /oracle/stats/:providerAddress` | Reports submitted, challenges faced, slash history (from chain) |
| Alert log | API scheduler | Log-based alert when a project misses its reporting window + grace |

### Starting the oracle monitor

```bash
cd oracle
npm run monitor            # starts http server on $ORACLE_MONITOR_PORT (default 8080)
```

Endpoints:

- `GET /health` — health check per adapter (Verra registry, satellite, IoT).
- `GET /staleness` — staleness from `ORACLE_STALENESS_FILE` (optional JSON input).
- `POST /staleness` — compute staleness from a JSON body:

```json
{
  "projects": [
    {
      "projectId": "VCS-1234",
      "methodology": "VERRA-VCS",
      "createdAt": "2024-01-01T00:00:00Z",
      "lastVerifiedAt": "2025-02-01T00:00:00Z"
    }
  ]
}
```

### API endpoints

```bash
# Provider stats + slash/challenge history straight from the chain
curl http://localhost:3000/oracle/stats/GBUDFMPN4L7SE6Y3S6W7F7Q5L7Y3S6W7F7Q5L7Y3S6W7F7Q5L7Y3S6W7F

# Staleness metric per project and provider
curl http://localhost:3000/oracle/monitoring/staleness
```

## Staleness metric definition

- **Cadence**: expected seconds between verified reports, per methodology
  (`VERRA-VCS` = 365d, `REMOTE-SENSING` = 90d, `IOT-SENSORS` = 30d; override
  via `ORACLE_CADENCE_SECONDS`).
- **Grace**: additional slack before alerting (`ORACLE_GRACE_SECONDS`, default 30d).
- `expectedNextReportAt = lastVerifiedAt + cadence + grace`.
- A project with no verified report falls back to its `createdAt` as baseline.
- `isStale = now > expectedNextReportAt`.

The API scheduler evaluates this every 6 hours, logs a `WARN` per stale project
(redis-deduplicated so each project alerts at most once per 24h), and the
result is queryable at `GET /oracle/monitoring/staleness`.

## Interpreting provider stats

`GET /oracle/stats/:providerAddress` returns (from chain storage):

- `reportsSubmitted` — lifetime reports submitted.
- `challengesFaced` — reports that were challenged.
- `slashes` / `totalPenalty` — rejected challenges that slashed stake (10% each).
- `slashHistory` — per-slash record (`reportId`, `penalty`, `remainingStake`, `activeAfter`).
- `challengeHistory` — per-challenge record with resolution.

A provider accumulating slashes, or dropping to `active: false` (stake
zeroed), has been through the enforcement path and should be reviewed.

## Alert → action matrix

| Alert | Meaning | Action |
|-------|---------|--------|
| `Oracle alert: project X is stale` | No verified report within cadence + grace | Contact provider; verify ingest jobs are running; check adapter health |
| `Adapter <x> status: down` | Upstream returned 5xx, timeout, or DNS failure | Check upstream provider status / credentials / network |
| `Adapter <x> status: degraded` | 4xx response, or latency above threshold | Check API keys, rate limits, quota |
| `provider slashed` event / `slashes > 0` | A rejected challenge applied the 10% penalty | Investigate report quality; watch stake; consider rotation |

## Recovery flow

1. **Confirm scope.** Is one adapter down or the whole chain RPC?
   `GET /health` isolates upstreams; `GET /oracle/monitoring/staleness` shows
   which projects are affected.
2. **Fix the ingest path.** Check the `oracle` ingest jobs
   (`npm run ingest`, `npm run monitor`), credentials, and upstream quotas.
3. **Re-run ingestion.** Re-publish the missed report via the API
   (`POST /oracle/reports`) so a fresh verified report resets the staleness
   clock.
4. **Escalate within the challenge window.** A report that stays un-verified
   past the 72-hour challenge window cannot be corrected without a new
   submission.
5. **Rotate or de-activate.** For providers that repeatedly fail, use
   `remove_provider` (admin) or let slashing deactivate them at zero stake.
6. **Verify recovery.** `GET /oracle/monitoring/staleness` should flip
   `isStale` to `false` for the affected projects within the next scheduler
   cycle.
