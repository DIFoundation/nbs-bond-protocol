import { uploadEvidence, IpfsPinConfig, IpfsUploadResult } from './evidence';

/**
 * Backwards-compatible wrapper around `uploadEvidence`.
 *
 * `uploadToIpfs(data, config)` hashes `data` (see `ipfs/evidence.ts`) and pins
 * it to the configured IPFS provider. The returned `hash` is the content
 * address to store as `ipfs_evidence_hash`.
 */
export async function uploadToIpfs(
  data: Record<string, unknown>,
  config: IpfsPinConfig,
): Promise<IpfsUploadResult> {
  const result = await uploadEvidence(data, config);
  return {
    hash: result.hash,
    gatewayUrl: result.gatewayUrl,
    pinSize: result.pinSize,
    timestamp: result.timestamp,
  };
}
