import { Injectable } from '@nestjs/common';
import { ContractService } from '../stellar/contract.service';
import { StellarService } from '../stellar/stellar.service';
import { NonceService } from '../common/services/nonce.service';
import { ListBondDto } from './dto/list-bond.dto';
import { BuyBondDto } from './dto/buy-bond.dto';
import {
  OrderResponse,
  OrderStatus,
} from './interfaces/marketplace.interface';
import { createClient, RedisClientType } from '@redis/client';
import { nativeToScVal, scValToNative, Address } from '@stellar/stellar-sdk';
import { PaginatedResponse } from '../common/dto/pagination.dto';

const DEX_ROUTER = () => process.env.DEX_ROUTER_ADDRESS || '';

@Injectable()
export class DexService {
  private redis: RedisClientType;

  constructor(
    private readonly contractService: ContractService,
    private readonly stellarService: StellarService,
    private readonly nonceService: NonceService,
  ) {
    this.redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    this.redis.connect().catch(() => {});
  }

  async listOrders(
    bondId?: number,
    status?: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<OrderResponse>> {
    const cacheKey = `orders:${bondId || 'all'}:${status || 'all'}:${page}:${limit}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const orders: OrderResponse[] = [];
    let index = 1;

    while (true) {
      try {
        const orderScVal = await this.contractService.simulateCall({
          contractAddress: DEX_ROUTER(),
          method: 'get_order',
          args: [nativeToScVal(BigInt(index), { type: 'u64' })],
        });
        const order = this.decodeOrder(scValToNative(orderScVal) as any[]);

        if (bondId && order.bondId !== bondId) {
          index++;
          continue;
        }
        if (status && order.status !== status) {
          index++;
          continue;
        }

        orders.push(order);
        index++;
      } catch {
        break;
      }
    }

    const start = (page - 1) * limit;
    const paged = orders.slice(start, start + limit);

    const result = {
      data: paged,
      meta: { page, limit, total: orders.length, totalPages: Math.ceil(orders.length / limit) || 1 },
    };

    await this.redis.setEx(cacheKey, 30, JSON.stringify(result));
    return result;
  }

  async listBondTokens(dto: ListBondDto, sellerAddress: string): Promise<OrderResponse> {
    const adminSecret = this.getAdminSecret();
    const nonce = await this.nonceService.next(DEX_ROUTER(), sellerAddress);

    const { result } = await this.contractService.invokeContractMethod(
      DEX_ROUTER(), 'list_bond_tokens', adminSecret,
      [
        Address.fromString(sellerAddress).toScVal(),
        nativeToScVal(BigInt(dto.bondId), { type: 'u64' }),
        nativeToScVal(BigInt(dto.amount), { type: 'i128' }),
        nativeToScVal(BigInt(dto.pricePerToken), { type: 'i128' }),
        nativeToScVal(dto.quoteAsset, { type: 'symbol' }),
        nativeToScVal(BigInt(dto.expiresAfterSeconds || 604800), { type: 'u64' }),
      ],
      nonce,
    );

    const orderId = Number(scValToNative(result));
    await this.redis.del(`orders:*`);
    return this.getOrder(orderId);
  }

  async buyBondTokens(dto: BuyBondDto, buyerAddress: string): Promise<OrderResponse> {
    const adminSecret = this.getAdminSecret();
    const nonce = await this.nonceService.next(DEX_ROUTER(), buyerAddress);

    await this.contractService.invokeContractMethod(
      DEX_ROUTER(), 'execute_purchase', adminSecret,
      [
        Address.fromString(buyerAddress).toScVal(),
        nativeToScVal(BigInt(dto.orderId), { type: 'u64' }),
        nativeToScVal(BigInt(dto.maxPrice), { type: 'i128' }),
        nativeToScVal(BigInt(dto.amount), { type: 'i128' }),
      ],
      nonce,
    );

    await this.redis.del(`orders:*`);
    return this.getOrder(dto.orderId);
  }

  async cancelOrder(orderId: number, callerAddress: string): Promise<void> {
    const adminSecret = this.getAdminSecret();
    const nonce = await this.nonceService.next(DEX_ROUTER(), callerAddress);

    await this.contractService.invokeContractMethod(
      DEX_ROUTER(), 'cancel_listing', adminSecret,
      [
        Address.fromString(callerAddress).toScVal(),
        nativeToScVal(BigInt(orderId), { type: 'u64' }),
      ],
      nonce,
    );

    await this.redis.del(`orders:*`);
  }

  async getOrder(orderId: number): Promise<OrderResponse> {
    const cacheKey = `order:${orderId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const orderScVal = await this.contractService.simulateCall({
      contractAddress: DEX_ROUTER(),
      method: 'get_order',
      args: [nativeToScVal(BigInt(orderId), { type: 'u64' })],
    });
    const order = this.decodeOrder(scValToNative(orderScVal) as any[]);

    await this.redis.setEx(cacheKey, 60, JSON.stringify(order));
    return order;
  }

  private decodeOrder(data: any[]): OrderResponse {
    return {
      id: Number(data[0]),
      seller: data[1] as string,
      bondId: Number(data[2]),
      amount: Number(data[3]),
      pricePerToken: Number(data[4]),
      quoteAsset: data[5] as 'USDC' | 'XLM',
      status: this.orderStatusFromIndex(Number(data[6])),
      createdAt: new Date(Number(data[7]) * 1000).toISOString(),
    };
  }

  private orderStatusFromIndex(index: number): OrderStatus {
    return (
      [
        OrderStatus.Open,
        OrderStatus.PartiallyFilled,
        OrderStatus.Filled,
        OrderStatus.Cancelled,
        OrderStatus.Expired,
      ][index] ?? OrderStatus.Open
    );
  }

  private getAdminSecret(): string {
    return process.env.ADMIN_SECRET_KEY || '';
  }
}
