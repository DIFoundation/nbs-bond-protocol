import { Injectable } from '@nestjs/common';
import { OracleProviderAdapter, MeasurementData } from './provider.interface';

@Injectable()
export class BlueCarbonProvider implements OracleProviderAdapter {
  readonly name = 'BlueCarbonObservatory';
  readonly methodology = 'BLUE-CARBON';

  async fetchMeasurement(projectId: string): Promise<MeasurementData> {
    return {
      projectId,
      periodStart: new Date('2025-01-01'),
      periodEnd: new Date('2025-03-31'),
      carbonSequesteredKg: 86000,
      confidence: 0.8,
      evidenceHashes: ['QmBlueCarbonMockHash789'],
    };
  }
}
