import { Test } from '@nestjs/testing';
import { xdr, scValToNative, nativeToScVal } from '@stellar/stellar-sdk';

jest.mock('@redis/client', () => {
  const mockClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    sMembers: jest.fn().mockResolvedValue([]),
    sAdd: jest.fn().mockResolvedValue(1),
  };
  return {
    createClient: jest.fn().mockReturnValue(mockClient),
  };
});

import { BondsService } from './bonds.service';
import { ContractService } from '../stellar/contract.service';
import { StellarService } from '../stellar/stellar.service';
import { NonceService } from '../common/services/nonce.service';

describe('BondsService', () => {
  let service: BondsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BondsService,
        { provide: ContractService, useValue: {} },
        { provide: StellarService, useValue: {} },
        {
          provide: NonceService,
          useValue: { next: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();

    service = moduleRef.get(BondsService);
  });

  describe('encodeBondConfig', () => {
    it('encodes a CreateBondDto as the contract BondConfig struct', () => {
      const encoded = (service as any).encodeBondConfig({
        projectId: 'a1b2'.padEnd(64, '0'),
        faceValue: 1000,
        couponSchedule: [1000000, 2000000],
        creditType: 'Carbon',
        maturityDate: 3000000,
        totalSupply: 10000,
      });

      const raw = scValToNative(encoded) as any[];

      expect(Buffer.from(raw[0] as Uint8Array).toString('hex')).toBe(
        'a1b2'.padEnd(64, '0'),
      );
      expect(raw[1]).toBe(BigInt(1000));
      expect((raw[2] as bigint[]).map(Number)).toEqual([1000000, 2000000]);
      expect(raw[3]).toBe('Carbon');
      expect(raw[4]).toBe(BigInt(3000000));
      expect(raw[5]).toBe(BigInt(10000));
    });
  });

  describe('distributeCoupon arg encoding', () => {
    it('places the admin caller first and passes a scalar report id', async () => {
      const contractService = {
        invokeContractMethod: jest.fn().mockResolvedValue({
          result: xdr.ScVal.scvVec([
            nativeToScVal(BigInt(1), { type: 'u64' }),
            xdr.ScVal.scvU32(0),
            nativeToScVal(BigInt(1_000_000), { type: 'i128' }),
            xdr.ScVal.scvU32(1),
          ]),
          successful: true,
        }),
      };
      const stellarService = {
        getKeypairFromSecret: jest.fn().mockReturnValue({
          publicKey: () =>
            'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        }),
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          BondsService,
          { provide: ContractService, useValue: contractService },
          { provide: StellarService, useValue: stellarService },
          {
            provide: NonceService,
            useValue: { next: jest.fn().mockResolvedValue(0) },
          },
        ],
      }).compile();

      const svc = moduleRef.get(BondsService);
      await svc.distributeCoupon(1, { periodIndex: 0, reportId: 7 });

      const [contractAddress, method, , args] =
        contractService.invokeContractMethod.mock.calls[0];

      expect(contractAddress).toBe('');
      expect(method).toBe('distribute_coupon');
      expect(args.length).toBe(5);
      expect(scValToNative(args[0])).toBe(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      );
      expect(scValToNative(args[4])).toBe(BigInt(7));
    });
  });
});
