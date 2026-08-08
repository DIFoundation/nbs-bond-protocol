import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DexService } from './dex.service';
import { ContractService } from '../stellar/contract.service';
import { StellarService } from '../stellar/stellar.service';
import { NonceService } from '../common/services/nonce.service';
import { OrderStatus } from './interfaces/marketplace.interface';
import { xdr, scValToNative, nativeToScVal, Address } from '@stellar/stellar-sdk';

jest.mock('@redis/client', () => {
  const mockClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  };
  return {
    createClient: jest.fn().mockReturnValue(mockClient),
  };
});

const SELLER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const BUYER = 'GDYTRSBHRNHV6ARX4B6D3MOTAFUQDZZUFXLWAHDNK74XXNDR2B7Q7HMR';

const orderScVal = xdr.ScVal.scvVec([
  nativeToScVal(BigInt(7), { type: 'u64' }),
  Address.fromString(SELLER).toScVal(),
  nativeToScVal(BigInt(3), { type: 'u64' }),
  nativeToScVal(BigInt(1000), { type: 'i128' }),
  nativeToScVal(BigInt(25), { type: 'i128' }),
  nativeToScVal('USDC', { type: 'symbol' }),
  xdr.ScVal.scvU32(0),
  nativeToScVal(BigInt(1700000000), { type: 'u64' }),
  nativeToScVal(BigInt(1700604800), { type: 'u64' }),
]);

interface Mocks {
  invokeContractMethod: jest.Mock;
  simulateCall: jest.Mock;
  nonceNext: jest.Mock;
  service: DexService;
}

async function buildService(escrowBalance: number): Promise<Mocks> {
  const invokeContractMethod = jest.fn().mockResolvedValue({
    result: xdr.ScVal.scvVoid(),
    successful: true,
  });
  const simulateCall = jest.fn().mockImplementation(async ({ method }) => {
    if (method === 'get_order') return orderScVal;
    if (method === 'get_quote_balance') {
      return nativeToScVal(BigInt(escrowBalance), { type: 'i128' });
    }
    throw new Error(`unexpected method ${method}`);
  });

  const nonceNext = jest.fn();
  let nonce = 0;
  nonceNext.mockImplementation(() => Promise.resolve(nonce++));

  const moduleRef = await Test.createTestingModule({
    providers: [
      DexService,
      { provide: ContractService, useValue: { simulateCall, invokeContractMethod } },
      { provide: StellarService, useValue: {} },
      { provide: NonceService, useValue: { next: nonceNext } },
    ],
  }).compile();

  return {
    invokeContractMethod,
    simulateCall,
    nonceNext,
    service: moduleRef.get(DexService),
  };
}

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
    it('queries the contract with the address and quote asset symbol', async () => {
      const { service, simulateCall } = await buildService(42_000);

      const balance = await service.getQuoteBalance(BUYER, 'USDC');

      expect(balance).toBe(42_000);
      expect(simulateCall).toHaveBeenCalledWith({
        contractAddress: '',
        method: 'get_quote_balance',
        args: [
          Address.fromString(BUYER).toScVal(),
          nativeToScVal('USDC', { type: 'symbol' }),
        ],
      });
    });
  });

  describe('depositQuote', () => {
    it('wraps deposit_quote with (caller, quote_asset, amount) + nonce and returns the new balance', async () => {
      const { service, invokeContractMethod, nonceNext } = await buildService(100_000);

      const balance = await service.depositQuote(BUYER, 'USDC', 100_000);

      expect(balance).toBe(100_000);
      expect(nonceNext).toHaveBeenCalledWith('', BUYER);

      const [, method, , args, nonce] = invokeContractMethod.mock.calls[0];
      expect(method).toBe('deposit_quote');
      expect(args.length).toBe(3);
      expect(scValToNative(args[0])).toBe(BUYER);
      expect(scValToNative(args[1])).toBe('USDC');
      expect(scValToNative(args[2])).toBe(BigInt(100_000));
      expect(nonce).toBe(0);
    });
  });

  describe('withdrawQuote', () => {
    it('wraps withdraw_quote with (caller, quote_asset, amount) + nonce and returns the new balance', async () => {
      const { service, invokeContractMethod } = await buildService(25_000);

      const balance = await service.withdrawQuote(BUYER, 'USDC', 75_000);

      expect(balance).toBe(25_000);

      const [, method, , args, nonce] = invokeContractMethod.mock.calls[0];
      expect(method).toBe('withdraw_quote');
      expect(args.length).toBe(3);
      expect(scValToNative(args[0])).toBe(BUYER);
      expect(scValToNative(args[1])).toBe('USDC');
      expect(scValToNative(args[2])).toBe(BigInt(75_000));
      expect(nonce).toBe(0);
    });
  });

  describe('buyBondTokens', () => {
    it('executes the purchase with (buyer, order_id, max_price, amount) + nonce when escrow is sufficient', async () => {
      const { service, invokeContractMethod } = await buildService(100_000);

      const order = await service.buyBondTokens(
        { orderId: 7, amount: 1000, maxPrice: 25 },
        BUYER,
      );

      expect(order.id).toBe(7);

      const [, method, , args, nonce] = invokeContractMethod.mock.calls[0];
      expect(method).toBe('execute_purchase');
      expect(args.length).toBe(4);
      expect(scValToNative(args[0])).toBe(BUYER);
      expect(scValToNative(args[1])).toBe(BigInt(7));
      expect(scValToNative(args[2])).toBe(BigInt(25));
      expect(scValToNative(args[3])).toBe(BigInt(1000));
      expect(nonce).toBe(0);
    });

    it('rejects with a clear 4xx when the escrowed balance is insufficient', async () => {
      const { service, invokeContractMethod } = await buildService(10_000);

      await expect(
        service.buyBondTokens({ orderId: 7, amount: 1000, maxPrice: 25 }, BUYER),
      ).rejects.toThrow(
        new BadRequestException(
          'Insufficient escrowed USDC: required 25000, escrowed 10000. ' +
            'Call POST /marketplace/escrow/deposit before purchasing.',
        ),
      );

      expect(
        invokeContractMethod.mock.calls.some((call) => call[1] === 'execute_purchase'),
      ).toBe(false);
    });
  });

  describe('deposit → purchase → withdrawal flow', () => {
    it('moves escrowed funds through a full buy cycle with sequential nonces', async () => {
      const { service, invokeContractMethod, nonceNext } = await buildService(100_000);

      const afterDeposit = await service.depositQuote(BUYER, 'USDC', 100_000);
      expect(afterDeposit).toBe(100_000);

      const order = await service.buyBondTokens(
        { orderId: 7, amount: 1000, maxPrice: 25 },
        BUYER,
      );
      expect(order.status).toBe(OrderStatus.Open);

      const afterWithdraw = await service.withdrawQuote(BUYER, 'USDC', 75_000);
      expect(afterWithdraw).toBe(100_000);

      const methods = invokeContractMethod.mock.calls.map((call) => call[1]);
      expect(methods).toEqual(['deposit_quote', 'execute_purchase', 'withdraw_quote']);

      const nonces = invokeContractMethod.mock.calls.map((call) => call[4]);
      expect(nonces).toEqual([0, 1, 2]);

      expect(nonceNext).toHaveBeenCalledTimes(3);

      const purchaseArgs = invokeContractMethod.mock.calls[1][3];
      expect(purchaseArgs.length).toBe(4);
      expect(scValToNative(purchaseArgs[0])).toBe(BUYER);
      expect(scValToNative(purchaseArgs[1])).toBe(BigInt(7));
      expect(scValToNative(purchaseArgs[2])).toBe(BigInt(25));
      expect(scValToNative(purchaseArgs[3])).toBe(BigInt(1000));
    });
  });
});
