# Oracle Design

## Architecture
Multi-source, multi-layer: Auditors + Satellite + IoT → OracleConsumer contract

## Provider Lifecycle
Register → Whitelisted → Submit Reports → Challenge Window → Verify/Reject

## Report Format
```
{
  project_id: BytesN<32>,
  period_start: u64,
  period_end: u64,
  carbon_sequestered: i128,
  methodology: Symbol,
  provider_signature: BytesN<64>,
  ipfs_evidence_hash: BytesN<32>,
}
```

## Multi-Source Verification Threshold
A report only reaches `Verified` status after **independent verifications** meet the configured threshold:

- `set_signature_threshold(threshold)` sets the minimum number of distinct verifiers required (defaults to `1`).
- Any admin or active provider may call `verify_report`. Each call records the verifier under `ReportVerifiers(report_id)` and increments `VerificationCount(report_id)`.
- Verifying the **same** report twice by the same address is a no-op (deduplicated, no double counting).
- A provider cannot verify its **own** report (`InvalidSignature`) — this guarantees the threshold represents genuinely independent sources.
- A report whose status is no longer `Pending` (challenged, already verified) cannot be re-verified.
- `get_report_verifiers(report_id)` and `get_verification_count(report_id)` expose the audit trail on-chain.

The admin can verify a report and it counts toward the threshold, but the submitting provider's own signature never does.

## Challenge Mechanism
- 72-hour window from submission
- Any address can challenge with counter-evidence (IPFS hash)
- Admin resolves via on-chain vote

## Security Model
- Provider whitelist (admin-managed)
- Signature threshold requires multiple independent sources for verification
- Coupon distributions consume only `Verified` reports (enforced by `CouponEngine`)
- Stake requirement (future)
- Multi-sig for high-value reports
