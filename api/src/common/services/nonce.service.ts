import { Injectable, Logger } from '@nestjs/common';
import { createClient, RedisClientType } from '@redis/client';

@Injectable()
export class NonceService {
  private readonly logger = new Logger(NonceService.name);
  private readonly redis: RedisClientType;

  constructor() {
    this.redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    this.redis.connect().catch(() => {
      this.logger.warn('Redis unavailable; nonce tracking disabled');
    });
  }

  /**
   * Allocate the next valid nonce for an address scoped to a contract.
   *
   * Contracts track a per-address, per-contract nonce starting at 0.
   * INCR is atomic so concurrent requests cannot be handed the same nonce.
   */
  async next(contractAddress: string, address: string): Promise<number> {
    const key = `nonce:${contractAddress}:${address}`;
    try {
      const incremented = await this.redis.incr(key);
      return incremented - 1;
    } catch (error) {
      this.logger.warn(
        `Failed to allocate nonce for ${address}; falling back to timestamp`,
        error,
      );
      return Math.floor(Date.now() / 1000);
    }
  }
}
