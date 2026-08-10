import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ProjectsModule } from '../projects/projects.module';
import { OracleController } from './oracle.controller';
import { OracleService } from './oracle.service';
import { OracleScheduler } from './oracle.scheduler';
import { OracleMonitoringService } from './oracle.monitoring.service';
import { VerraProvider } from './providers/verra.provider';
import { SatelliteProvider } from './providers/satellite.provider';

@Module({
  imports: [ScheduleModule.forRoot(), ProjectsModule],
  controllers: [OracleController],
  providers: [
    OracleService,
    OracleScheduler,
    OracleMonitoringService,
    VerraProvider,
    SatelliteProvider,
  ],
  exports: [OracleService, OracleMonitoringService],
})
export class OracleModule {}
