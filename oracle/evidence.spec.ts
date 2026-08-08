import {
  canonicalJson,
  hashEvidence,
  uploadEvidence,
  ipfsCidV0FromBytes,
  encodeBase58btc,
} from '../ipfs/evidence';
import { MockHttpClient } from './test-helpers';

const FIXTURE = {
  project_id: 'VCS-1234',
  carbon_sequestered: 50000,
};

describe('ipfs evidence hashing', () => {
  it('canonicalJson serializes objects with sorted keys', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('hashEvidence is deterministic for identical payloads', () => {
    const first = hashEvidence(FIXTURE);
    const second = hashEvidence({ ...FIXTURE });
    expect(first.ipfs_evidence_hash).toBe(second.ipfs_evidence_hash);
  });

  it('hashEvidence differs when the payload changes', () => {
    const base = hashEvidence(FIXTURE);
    const changed = hashEvidence({ ...FIXTURE, carbon_sequestered: 1 });
    expect(base.ipfs_evidence_hash).not.toBe(changed.ipfs_evidence_hash);
  });

  it('produces a valid CIDv0 base58btc hash with the Qm prefix', () => {
    const { ipfs_evidence_hash } = hashEvidence(FIXTURE);
    expect(ipfs_evidence_hash).toMatch(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
  });

  it('encodeBase58btc prefixes leading zero bytes with the zero digit', () => {
    expect(encodeBase58btc(Buffer.from([0x00, 0x00, 0x01]))).toBe('112');
    expect(encodeBase58btc(Buffer.from([0xff]))).toBe('5Q');
  });

  it('matches the canonical IPFS CIDv0 of an empty payload', () => {
    expect(ipfsCidV0FromBytes(Buffer.from('', 'utf8'))).toBe(
      'QmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n',
    );
  });
});

describe('uploadEvidence', () => {
  const config = {
    apiUrl: 'https://api.pinata.cloud',
    apiKey: 'key',
    secretKey: 'secret',
    gateway: 'https://gateway.pinata.cloud/ipfs/',
  };

  it('pins the payload and returns the evidence hash', async () => {
    const http = new MockHttpClient([
      { status: 200, data: { IpfsHash: 'QmPinataHash123', PinSize: 42 } },
    ]);
    const result = await uploadEvidence(FIXTURE, config, http);
    expect(result.hash).toBe('QmPinataHash123');
    expect(result.ipfs_evidence_hash).toBe(hashEvidence(FIXTURE).ipfs_evidence_hash);
    expect(result.gatewayUrl).toContain('QmPinataHash123');
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].url).toBe('https://api.pinata.cloud/pinning/pinJSONToIPFS');
  });

  it('throws when pinning credentials are missing', async () => {
    await expect(
      uploadEvidence(FIXTURE, { ...config, apiKey: '', secretKey: '' }),
    ).rejects.toThrow('IPFS_API_KEY');
  });

  it('throws when the pinning provider rejects the upload', async () => {
    const http = new MockHttpClient([
      { status: 401, data: { error: 'unauthorized' } },
    ]);
    await expect(uploadEvidence(FIXTURE, config, http)).rejects.toThrow(
      'IPFS upload failed',
    );
  });

  it('propagates network errors from the upstream provider', async () => {
    const http = new MockHttpClient([new Error('connection refused')]);
    await expect(uploadEvidence(FIXTURE, config, http)).rejects.toThrow(
      'connection refused',
    );
  });
});
