import { Test } from '@nestjs/testing';
import { xdr } from '@stellar/stellar-sdk';
import { OracleService } from './oracle.service';
import { ContractService } from '../stellar/contract.service';
import { IpfsService } from '../projects/ipfs.service';
import { StellarService } from '../stellar/stellar.service';
import { NonceService } from '../common/services/nonce.service';
import { ReportStatus } from './interfaces/oracle.interface';

describe('OracleService', () => {
  let service: OracleService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OracleService,
        { provide: ContractService, useValue: {} },
        { provide: IpfsService, useValue: {} },
        { provide: StellarService, useValue: {} },
        {
          provide: NonceService,
          useValue: { next: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();

    service = moduleRef.get(OracleService);
  });

  describe('decodeReport', () => {
    it('maps the contract Report struct to a ReportResponse', () => {
      const raw = [
        BigInt(4),
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        Buffer.from('a1b2'.padEnd(64, '0'), 'hex'),
        BigInt(1700000000),
        BigInt(1700086400),
        BigInt(1200),
        'VM0003',
        Buffer.from('c3d4'.padEnd(64, '0'), 'hex'),
        1,
        BigInt(1700001000),
        BigInt(0),
      ];

      expect((service as any).decodeReport(raw)).toEqual({
        id: 4,
        providerAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        projectId: 'a1b2'.padEnd(64, '0'),
        periodStart: 1700000000,
        periodEnd: 1700086400,
        carbonSequestered: 1200,
        methodology: 'VM0003',
        ipfsHash: 'c3d4'.padEnd(64, '0'),
        status: ReportStatus.Verified,
        createdAt: new Date(1700001000 * 1000).toISOString(),
      });
    });

    it.each([
      [0, ReportStatus.Pending],
      [1, ReportStatus.Verified],
      [2, ReportStatus.Challenged],
      [3, ReportStatus.Rejected],
    ])('maps status index %i to %s', (index, expected) => {
      const raw = [
        BigInt(1),
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        Buffer.alloc(32),
        BigInt(0),
        BigInt(0),
        BigInt(0),
        'VM0003',
        Buffer.alloc(32),
        index,
        BigInt(0),
        BigInt(0),
      ];

      expect((service as any).decodeReport(raw).status).toBe(expected);
    });
  });

  describe('toBytes32', () => {
    it('keeps a 64-char hex string as-is', () => {
      const hex = 'ab'.repeat(32);
      const scVal = (service as any).toBytes32(hex) as xdr.ScVal;
      expect(scVal.bytes().length).toBe(32);
    });

    it('digests a CID into 32 bytes via sha256', () => {
      const scVal = (service as any).toBytes32(
        'QmYwAPJzv5CZsnAzt8auVZRnTb7F8Pz6ePzE9LbYp8Xy7F',
      ) as xdr.ScVal;
      expect(scVal.bytes().length).toBe(32);
    });
  });
});
