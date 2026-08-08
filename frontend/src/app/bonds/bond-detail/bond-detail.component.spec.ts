import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { BondDetailComponent } from './bond-detail.component';
import { ApiService } from '../../shared/services/api.service';
import { WalletService } from '../../auth/wallet.service';
import { environment } from '../../../environments/environment';

describe('BondDetailComponent', () => {
  let fixture: ComponentFixture<BondDetailComponent>;
  let apiService: jasmine.SpyObj<ApiService>;
  let walletService: WalletService;

  const bond = {
    id: 1,
    projectId: 'a1b2',
    faceValue: 1000,
    couponSchedule: [1000000, 2000000],
    creditType: 'Carbon' as const,
    maturityDate: 3000000,
    totalSupply: 10000,
    totalSubscribed: 5000,
    status: 'Active' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    apiService = jasmine.createSpyObj('ApiService', [
      'getBond', 'subscribeToBond', 'claimCredits', 'transferBond',
      'getUndistributedTotal', 'sweepUndistributed',
    ]);
    apiService.getBond.and.returnValue(of(bond));
    apiService.getUndistributedTotal.and.returnValue(
      of({ bondId: 1, undistributedTotal: 7 }),
    );
    apiService.sweepUndistributed.and.returnValue(
      of({ bondId: 1, swept: 7, transactionHash: '0xabc' }),
    );

    await TestBed.configureTestingModule({
      imports: [BondDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => '1' } } },
        },
        { provide: ApiService, useValue: apiService },
        WalletService,
      ],
    }).compileComponents();

    walletService = TestBed.inject(WalletService);
  });

  const createFixture = (): void => {
    fixture = TestBed.createComponent(BondDetailComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
  };

  const adminSection = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('.admin-section');

  it('shows the undistributed total to the admin wallet', fakeAsync(() => {
    walletService.address.set(environment.adminAddress);
    createFixture();

    expect(apiService.getUndistributedTotal).toHaveBeenCalledWith(1);
    const section = adminSection();
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain('7');
    expect(section?.textContent).toContain('Sweep Undistributed');
  }));

  it('hides the admin panel from non-admin wallets', fakeAsync(() => {
    walletService.address.set(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    );
    createFixture();

    expect(apiService.getUndistributedTotal).not.toHaveBeenCalled();
    expect(adminSection()).toBeNull();
  }));

  it('sweeps undistributed credits only after confirmation', fakeAsync(() => {
    walletService.address.set(environment.adminAddress);
    createFixture();

    const confirmSpy = spyOn(window, 'confirm').and.returnValue(true);
    const sweepBtn = fixture.nativeElement.querySelector(
      '.sweep-btn',
    ) as HTMLButtonElement;
    expect(sweepBtn).not.toBeNull();
    sweepBtn.click();
    tick();
    fixture.detectChanges();

    expect(confirmSpy).toHaveBeenCalled();
    expect(apiService.sweepUndistributed).toHaveBeenCalledWith(1);
    expect(fixture.nativeElement.textContent).toContain('0xabc');
  }));

  it('does not sweep when confirmation is declined', fakeAsync(() => {
    walletService.address.set(environment.adminAddress);
    createFixture();

    spyOn(window, 'confirm').and.returnValue(false);
    const sweepBtn = fixture.nativeElement.querySelector(
      '.sweep-btn',
    ) as HTMLButtonElement;
    sweepBtn.click();

    expect(apiService.sweepUndistributed).not.toHaveBeenCalled();
  }));
});
