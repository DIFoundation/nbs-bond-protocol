import { Test } from '@nestjs/testing';
import { nativeToScVal } from '@stellar/stellar-sdk';
import { DexService } from './dex.service';
import { ContractService } from '../stellar/contract.service';
import { StellarService } from '../stellar/stellar.service';
import { NonceService } from '../common/services/nonce.service';
import { OrderStatus } from './interfaces/marketplace.interface';
import { xdr, scValToNative, nativeToScVal, Address } from '@stellar/stellar-sdk';

describe('DexService', () => {
  let service: DexService;
  let contractService: { simulateCall: jest.Mock; invokeContractMethod: jest.Mock };

  const simulateCallMock = jest.fn();
  const invokeContractMethodMock = jest.fn();

  beforeAll(async () => {
    contractService = {
      simulateCall: simulateCallMock,
      invokeContractMethod: invokeContractMethodMock,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DexService,
        { provide: ContractService, useValue: contractService },
        { provide: StellarService, useValue: {} },
        {
          provide: NonceService,
          useValue: { next: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();

    service = moduleRef.get(DexService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('decodeOrder', () => {
    const seller = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('DexService', () => {
  describe('decodeOrder', () => {
    it('maps the contract Order struct to an OrderResponse', async () => {
      const { service } = await buildService(0);
      const raw = [
        BigInt(7),
        SELLER,
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
        seller: SELLER,
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
    ])('maps status index %i to %s', async (index, expected) => {
      const { service } = await buildService(0);
      const raw = [
        BigInt(1),
        SELLER,
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

  describe('getQuoteBalance', () => {
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    it('reads the escrowed balance for the requested asset', async () => {
      simulateCallMock.mockResolvedValue(nativeToScVal(BigInt(25_000), { type: 'i128' }));

      await expect(service.getQuoteBalance(address, 'USDC')).resolves.toEqual({
        address,
        asset: 'USDC',
        balance: 25000,
      });

      expect(simulateCallMock).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'get_quote_balance' }),
      );
    });
  });

  describe('depositQuote', () => {
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    it('calls deposit_quote and returns a transaction response', async () => {
      invokeContractMethodMock.mockResolvedValue({
        transactionHash: 'abc123',
        successful: true,
      });

      await expect(
        service.depositQuote({ asset: 'USDC', amount: 1000 }, address),
      ).resolves.toEqual({
        address,
        asset: 'USDC',
        amount: 1000,
        transactionHash: 'abc123',
      });

      expect(invokeContractMethodMock).toHaveBeenCalledWith(
        expect.any(String),
        'deposit_quote',
        expect.any(String),
        expect.any(Array),
        0,
      );
    });
  });

  describe('withdrawQuote', () => {
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    it('calls withdraw_quote and returns a transaction response', async () => {
      invokeContractMethodMock.mockResolvedValue({
        transactionHash: 'def456',
        successful: true,
      });

      await expect(
        service.withdrawQuote({ asset: 'XLM', amount: 500 }, address),
      ).resolves.toEqual({
        address,
        asset: 'XLM',
        amount: 500,
        transactionHash: 'def456',
      });

      expect(invokeContractMethodMock).toHaveBeenCalledWith(
        expect.any(String),
        'withdraw_quote',
        expect.any(String),
        expect.any(Array),
        0,
      );
    });
  });
});
