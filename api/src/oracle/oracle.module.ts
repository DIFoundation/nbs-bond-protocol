import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ProjectsModule } from '../projects/projects.module';
import { OracleController } from './oracle.controller';
import { OracleService } from './oracle.service';
import { OracleScheduler } from './oracle.scheduler';
import { VerraProvider } from './providers/verra.provider';
import { SatelliteProvider } from './providers/satellite.provider';
import { BlueCarbonProvider } from './providers/blue-carbon.provider';

@Module({
  imports: [ScheduleModule.forRoot(), ProjectsModule],
  controllers: [OracleController],
  providers: [
    OracleService,
    OracleScheduler,
    VerraProvider,
    SatelliteProvider,
    BlueCarbonProvider,
  ],
  exports: [OracleService],
})
export class OracleModule {}
