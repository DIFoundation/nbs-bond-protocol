import { Test } from '@nestjs/testing';
import { OracleMonitoringService } from './oracle.monitoring.service';
import { ProjectsService } from '../projects/projects.service';
import { OracleService } from './oracle.service';
import { ReportStatus } from './interfaces/oracle.interface';

const NOW = Date.UTC(2026, 0, 1, 0, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const CADENCE_GRACE_MS = (365 + 30) * 24 * 60 * 60 * 1000;

describe('OracleMonitoringService', () => {
  let service: OracleMonitoringService;
  let projectsService: { findAll: jest.Mock };
  let oracleService: { getProjectReports: jest.Mock };

  const makeProject = (id: number, methodology: string, createdAt = NOW - DAY) => ({
    id,
    name: `Project ${id}`,
    status: 'Approved',
    methodology,
    country: 'PE',
    metadataIpfsHash: '00',
    ownerAddress: 'G000000000000000000000000000000000000000000000000000000000000000',
    totalAreaHa: 10,
    carbonSequestrationEstimate: 100,
    createdAt: new Date(createdAt).toISOString(),
  });

  const makeReport = (verifiedAt: number, providerAddress: string) => ({
    id: 1,
    projectId: 'aa',
    periodStart: 1,
    periodEnd: 2,
    carbonSequestered: 100,
    methodology: 'VERRA-VCS',
    ipfsHash: 'bb',
    providerAddress,
    status: ReportStatus.Verified,
    createdAt: new Date(verifiedAt - DAY).toISOString(),
    verifiedAt: new Date(verifiedAt).toISOString(),
  });

  beforeEach(async () => {
    projectsService = { findAll: jest.fn() };
    oracleService = { getProjectReports: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OracleMonitoringService,
        { provide: ProjectsService, useValue: projectsService },
        { provide: OracleService, useValue: oracleService },
      ],
    }).compile();

    service = moduleRef.get(OracleMonitoringService);
  });

  describe('computeStaleness', () => {
    it('marks a project stale when its last verified report exceeds cadence + grace', async () => {
      projectsService.findAll.mockResolvedValue({
        data: [makeProject(1, 'VERRA-VCS')],
        meta: { total: 1 },
      });
      oracleService.getProjectReports.mockResolvedValue([
        makeReport(NOW - CADENCE_GRACE_MS - DAY, 'GPROVIDER'),
      ]);

      const report = await service.computeStaleness(NOW);
      expect(report.projects[0].isStale).toBe(true);
      expect(report.projects[0].stalenessSeconds).toBe(
        (CADENCE_GRACE_MS + DAY) / 1000,
      );
    });

    it('marks a project healthy while reports are within the reporting window', async () => {
      projectsService.findAll.mockResolvedValue({
        data: [makeProject(1, 'VERRA-VCS')],
        meta: { total: 1 },
      });
      oracleService.getProjectReports.mockResolvedValue([
        makeReport(NOW - DAY, 'GPROVIDER'),
      ]);

      const report = await service.computeStaleness(NOW);
      expect(report.projects[0].isStale).toBe(false);
      expect(report.projects[0].lastVerifiedAt).toBe(
        new Date(NOW - DAY).toISOString(),
      );
    });

    it('marks a never-reported project stale once it exceeds the window', async () => {
      projectsService.findAll.mockResolvedValue({
        data: [makeProject(1, 'VERRA-VCS', NOW - CADENCE_GRACE_MS - DAY)],
        meta: { total: 1 },
      });
      oracleService.getProjectReports.mockResolvedValue([]);

      const report = await service.computeStaleness(NOW);
      expect(report.projects[0].isStale).toBe(true);
      expect(report.projects[0].lastVerifiedAt).toBe(
        new Date(NOW - CADENCE_GRACE_MS - DAY).toISOString(),
      );
    });

    it('applies a shorter cadence for remote-sensing methodologies', async () => {
      projectsService.findAll.mockResolvedValue({
        data: [makeProject(1, 'REMOTE-SENSING')],
        meta: { total: 1 },
      });
      oracleService.getProjectReports.mockResolvedValue([
        makeReport(NOW - 200 * DAY, 'GPROVIDER'),
      ]);

      const report = await service.computeStaleness(NOW);
      expect(report.projects[0].expectedCadenceSeconds).toBe(90 * 24 * 60 * 60);
      expect(report.projects[0].isStale).toBe(true);
    });

    it('aggregates provider staleness from verified reports', async () => {
      projectsService.findAll.mockResolvedValue({
        data: [
          makeProject(1, 'VERRA-VCS'),
          makeProject(2, 'VERRA-VCS'),
        ],
        meta: { total: 2 },
      });
      oracleService.getProjectReports.mockImplementation((projectId: string) =>
        Promise.resolve([
          projectId === '1'
            ? makeReport(NOW - 2 * DAY, 'GPROVIDER')
            : makeReport(NOW - DAY, 'GPROVIDER'),
        ]),
      );

      const report = await service.computeStaleness(NOW);
      expect(report.providers).toHaveLength(1);
      expect(report.providers[0].providerAddress).toBe('GPROVIDER');
      expect(report.providers[0].projectIds.sort()).toEqual(['1', '2']);
      expect(report.providers[0].isStale).toBe(false);
    });

    it('tolerates report-fetch failures', async () => {
      projectsService.findAll.mockResolvedValue({
        data: [makeProject(1, 'VERRA-VCS', NOW - CADENCE_GRACE_MS - DAY)],
        meta: { total: 1 },
      });
      oracleService.getProjectReports.mockRejectedValue(new Error('rpc down'));

      const report = await service.computeStaleness(NOW);
      expect(report.projects[0].isStale).toBe(true);
      expect(report.projects).toHaveLength(1);
    });
  });
});
