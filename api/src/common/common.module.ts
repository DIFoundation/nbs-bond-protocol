import { Global, Module } from '@nestjs/common';
import { NonceService } from './services/nonce.service';

@Global()
@Module({
  providers: [NonceService],
  exports: [NonceService],
})
export class CommonModule {}
