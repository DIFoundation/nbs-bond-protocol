import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ContractService } from '../stellar/contract.service';
import { IpfsService } from '../projects/ipfs.service';
import { NonceService } from '../common/services/nonce.service';
import { SubmitReportDto } from './dto/submit-report.dto';
import { ChallengeDto } from './dto/challenge.dto';
import { RegisterProviderDto } from './dto/register-provider.dto';
import {
  ReportResponse,
  ChallengeResponse,
  ProviderResponse,
  ReportStatus,
} from './interfaces/oracle.interface';
import { createClient, RedisClientType } from '@redis/client';
import { nativeToScVal, scValToNative, Address, xdr } from '@stellar/stellar-sdk';
import { StellarService } from '../stellar/stellar.service';

const ORACLE_CONSUMER = () => process.env.ORACLE_CONSUMER_ADDRESS || '';

@Injectable()
export class OracleService {
  private redis: RedisClientType;

  constructor(
    private readonly contractService: ContractService,
    private readonly ipfsService: IpfsService,
    private readonly stellarService: StellarService,
    private readonly nonceService: NonceService,
  ) {
    this.redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    this.redis.connect().catch(() => {});
  }

  async submitReport(dto: SubmitReportDto, providerAddress: string): Promise<ReportResponse> {
    const ipfsResult = await this.ipfsService.uploadJson({
      projectId: dto.projectId,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      carbonSequestered: dto.carbonSequestered,
      methodology: dto.methodology,
      evidenceHash: dto.evidenceHash,
      providerAddress,
      timestamp: new Date().toISOString(),
    });

    const adminSecret = this.getAdminSecret();
    const nonce = await this.nonceService.next(ORACLE_CONSUMER(), providerAddress);

    const { result } = await this.contractService.invokeContractMethod(
      ORACLE_CONSUMER(), 'submit_report', adminSecret,
      [
        Address.fromString(providerAddress).toScVal(),
        this.toBytes32(dto.projectId),
        nativeToScVal(BigInt(dto.periodStart), { type: 'u64' }),
        nativeToScVal(BigInt(dto.periodEnd), { type: 'u64' }),
        nativeToScVal(BigInt(dto.carbonSequestered), { type: 'i128' }),
        nativeToScVal(dto.methodology, { type: 'symbol' }),
        this.toBytes32(ipfsResult.hash),
      ],
      nonce,
    );

    const reportId = Number(scValToNative(result));

    return {
      id: reportId,
      projectId: dto.projectId,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      carbonSequestered: dto.carbonSequestered,
      methodology: dto.methodology,
      ipfsHash: ipfsResult.hash,
      providerAddress,
      status: ReportStatus.Pending,
      createdAt: new Date().toISOString(),
    };
  }

  async getProjectReports(projectId: string): Promise<ReportResponse[]> {
    const cacheKey = `reports:${projectId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const idsScVal = await this.contractService.simulateCall({
      contractAddress: ORACLE_CONSUMER(),
      method: 'get_project_reports',
      args: [this.toBytes32(projectId)],
    });
    const ids = scValToNative(idsScVal) as number[];

    const reports: ReportResponse[] = [];
    for (const reportId of ids) {
      try {
        const reportScVal = await this.contractService.simulateCall({
          contractAddress: ORACLE_CONSUMER(),
          method: 'get_report',
          args: [nativeToScVal(BigInt(reportId), { type: 'u64' })],
        });
        reports.push(this.decodeReport(scValToNative(reportScVal) as any[]));
      } catch {}
    }

    await this.redis.setEx(cacheKey, 60, JSON.stringify(reports));
    return reports;
  }

  async challengeReport(reportId: number, dto: ChallengeDto, challengerAddress: string): Promise<ChallengeResponse> {
    const adminSecret = this.getAdminSecret();
    const nonce = await this.nonceService.next(ORACLE_CONSUMER(), challengerAddress);

    await this.contractService.invokeContractMethod(
      ORACLE_CONSUMER(), 'challenge_report', adminSecret,
      [
        Address.fromString(challengerAddress).toScVal(),
        nativeToScVal(BigInt(reportId), { type: 'u64' }),
        this.toBytes32(dto.counterEvidenceHash),
      ],
      nonce,
    );

    return {
      reportId,
      challengerAddress,
      reason: dto.reason,
      counterEvidenceHash: dto.counterEvidenceHash,
      resolved: false,
      createdAt: new Date().toISOString(),
    };
  }

  async registerProvider(dto: RegisterProviderDto): Promise<ProviderResponse> {
    const adminSecret = this.getAdminSecret();
    const adminAddress = this.stellarService.getKeypairFromSecret(adminSecret).publicKey();
    const nonce = await this.nonceService.next(ORACLE_CONSUMER(), adminAddress);

    await this.contractService.invokeContractMethod(
      ORACLE_CONSUMER(), 'register_provider', adminSecret,
      [
        Address.fromString(adminAddress).toScVal(),
        Address.fromString(dto.providerAddress).toScVal(),
        nativeToScVal(dto.methodology, { type: 'symbol' }),
      ],
      nonce,
    );

    return {
      providerAddress: dto.providerAddress,
      methodology: dto.methodology,
      name: `Oracle ${dto.providerAddress.slice(0, 6)}`,
      active: true,
      registeredAt: new Date().toISOString(),
    };
  }

  async listProviders(): Promise<ProviderResponse[]> {
    const cacheKey = 'oracle:providers';
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const listScVal = await this.contractService.simulateCall({
      contractAddress: ORACLE_CONSUMER(),
      method: 'list_providers',
      args: [],
    });
    const addresses = scValToNative(listScVal) as string[];

    const providers: ProviderResponse[] = [];
    for (const address of addresses) {
      try {
        const providerScVal = await this.contractService.simulateCall({
          contractAddress: ORACLE_CONSUMER(),
          method: 'get_provider',
          args: [Address.fromString(address).toScVal()],
        });
        const data = scValToNative(providerScVal) as any[];
        providers.push({
          providerAddress: data[0] as string,
          methodology: data[1] as string,
          name: `Oracle ${(data[0] as string).slice(0, 6)}`,
          active: data[3] as boolean,
          registeredAt: new Date(Number(data[4]) * 1000).toISOString(),
        });
      } catch {}
    }

    await this.redis.setEx(cacheKey, 120, JSON.stringify(providers));
    return providers;
  }

  private decodeReport(data: any[]): ReportResponse {
    return {
      id: Number(data[0]),
      providerAddress: data[1] as string,
      projectId: Buffer.from(data[2] as Uint8Array).toString('hex'),
      periodStart: Number(data[3]),
      periodEnd: Number(data[4]),
      carbonSequestered: Number(data[5]),
      methodology: data[6] as string,
      ipfsHash: Buffer.from(data[7] as Uint8Array).toString('hex'),
      status: this.reportStatusFromIndex(Number(data[8])),
      createdAt: new Date(Number(data[9]) * 1000).toISOString(),
    };
  }

  private reportStatusFromIndex(index: number): ReportStatus {
    return (
      [
        ReportStatus.Pending,
        ReportStatus.Verified,
        ReportStatus.Challenged,
        ReportStatus.Rejected,
      ][index] ?? ReportStatus.Pending
    );
  }

  private toBytes32(value: string): xdr.ScVal {
    const hex = Buffer.from(value, 'hex');
    const bytes = hex.length === 32 ? hex : createHash('sha256').update(value).digest();
    return xdr.ScVal.scvBytes(bytes);
  }

  private getAdminSecret(): string {
    return process.env.ADMIN_SECRET_KEY || '';
  }
}
