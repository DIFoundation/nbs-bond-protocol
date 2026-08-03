import { Test } from '@nestjs/testing';
import { DexService } from './dex.service';
import { ContractService } from '../stellar/contract.service';
import { StellarService } from '../stellar/stellar.service';
import { NonceService } from '../common/services/nonce.service';
import { OrderStatus } from './interfaces/marketplace.interface';

describe('DexService', () => {
  let service: DexService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DexService,
        { provide: ContractService, useValue: {} },
        { provide: StellarService, useValue: {} },
        {
          provide: NonceService,
          useValue: { next: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();

    service = moduleRef.get(DexService);
  });

  describe('decodeOrder', () => {
    const seller = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    it('maps the contract Order struct to an OrderResponse', () => {
      const raw = [
        BigInt(7),
        seller,
        BigInt(3),
        BigInt(1000),
        BigInt(25),
        'USDC',
        0,
        BigInt(1700000000),
        BigInt(1700604800),
      ];

      expect((service as any).decodeOrder(raw)).toEqual({
        id: 7,
        seller,
        bondId: 3,
        amount: 1000,
        pricePerToken: 25,
        quoteAsset: 'USDC',
        status: OrderStatus.Open,
        createdAt: new Date(1700000000 * 1000).toISOString(),
      });
    });

    it.each([
      [0, OrderStatus.Open],
      [1, OrderStatus.PartiallyFilled],
      [2, OrderStatus.Filled],
      [3, OrderStatus.Cancelled],
      [4, OrderStatus.Expired],
    ])('maps status index %i to %s', (index, expected) => {
      const raw = [
        BigInt(1),
        seller,
        BigInt(1),
        BigInt(1),
        BigInt(1),
        'XLM',
        index,
        BigInt(0),
        BigInt(0),
      ];

      expect((service as any).decodeOrder(raw).status).toBe(expected);
    });
  });
});
