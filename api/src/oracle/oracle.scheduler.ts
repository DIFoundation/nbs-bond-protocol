import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OracleService } from './oracle.service';
import { OracleMonitoringService } from './oracle.monitoring.service';
import { VerraProvider } from './providers/verra.provider';
import { SatelliteProvider } from './providers/satellite.provider';

@Injectable()
export class OracleScheduler {
  private readonly logger = new Logger(OracleScheduler.name);

  constructor(
    private readonly oracleService: OracleService,
    private readonly monitoringService: OracleMonitoringService,
    private readonly verraProvider: VerraProvider,
    private readonly satelliteProvider: SatelliteProvider,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollOracleData(): Promise<void> {
    this.logger.log('Oracle poll cycle started');

    try {
      const providers = [this.verraProvider, this.satelliteProvider];

      for (const provider of providers) {
        this.logger.log(`Polling provider: ${provider.name}`);
      }
    } catch (error) {
      this.logger.error(`Oracle poll cycle error: ${error.message}`);
    }

    this.logger.log('Oracle poll cycle completed');
  }

  @Cron('0 */6 * * *')
  async monitorProviderReliability(): Promise<void> {
    this.logger.log('Oracle reliability monitoring cycle started');

    try {
      const alerted = await this.monitoringService.alertStaleProjects();
      this.logger.log(
        `Oracle reliability monitoring cycle completed: ${alerted} alert(s) emitted`,
      );
    } catch (error) {
      this.logger.error(`Oracle reliability monitoring error: ${error.message}`);
    }
  }
}
