import { Test } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  Controller,
  Post,
  Body,
} from '@nestjs/common';
import * as request from 'supertest';
import { CreateBondDto } from '../src/bonds/dto/create-bond.dto';
import { SubscribeDto } from '../src/bonds/dto/subscribe.dto';
import { CreditTypeEnum } from '../src/bonds/interfaces/bond.interface';

@Controller()
class ValidationProbeController {
  @Post('bonds')
  createBond(@Body() dto: CreateBondDto) {
    return { ok: true, data: dto };
  }

  @Post('bonds/:id/subscribe')
  subscribe(@Body() dto: SubscribeDto) {
    return { ok: true, data: dto };
  }
}

describe('API validation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ValidationProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        validationError: { target: false, value: false },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create bond', () => {
    const validBond = {
      projectId: 'abcd',
      faceValue: 1000,
      couponSchedule: [1000000, 2000000],
      creditType: CreditTypeEnum.Carbon,
      maturityDate: 3000000,
      totalSupply: 10000,
    };

    it('accepts a valid payload and strips unknown fields', () => {
      return request(app.getHttpServer())
        .post('/bonds')
        .send({ ...validBond, extra: 'should-be-stripped' })
        .expect(201)
        .expect((res) => {
          expect(res.body.data).toEqual(validBond);
        });
    });

    it('rejects a payload without a coupon schedule', () => {
      const missing: Partial<CreateBondDto> = { ...validBond };
      delete missing.couponSchedule;
      return request(app.getHttpServer())
        .post('/bonds')
        .send(missing)
        .expect(400);
    });

    it('rejects an invalid credit type', () => {
      return request(app.getHttpServer())
        .post('/bonds')
        .send({ ...validBond, creditType: 'NotACreditType' })
        .expect(400);
    });

    it('coerces numeric strings into numbers', () => {
      const stringy = Object.fromEntries(
        Object.entries(validBond).map(([k, v]) => [
          k,
          typeof v === 'number' ? String(v) : v,
        ]),
      );
      return request(app.getHttpServer())
        .post('/bonds')
        .send(stringy)
        .expect(201)
        .expect((res) => {
          expect(res.body.data).toEqual(validBond);
        });
    });
  });

  describe('subscribe', () => {
    const validSubscribe = {
      amount: 100,
      nonce: 0,
      investorAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    };

    it('accepts a valid Stellar address', () => {
      return request(app.getHttpServer())
        .post('/bonds/1/subscribe')
        .send(validSubscribe)
        .expect(201);
    });

    it('rejects a non-Stellar investor address', () => {
      return request(app.getHttpServer())
        .post('/bonds/1/subscribe')
        .send({ ...validSubscribe, investorAddress: 'not-an-address' })
        .expect(400);
    });

    it('rejects a missing nonce', () => {
      const missing: Partial<SubscribeDto> = { ...validSubscribe };
      delete missing.nonce;
      return request(app.getHttpServer())
        .post('/bonds/1/subscribe')
        .send(missing)
        .expect(400);
    });
  });
});
