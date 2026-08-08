import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MarketplaceSellComponent } from './marketplace-sell.component';
import { ApiService } from '../../shared/services/api.service';
import { WalletService } from '../../auth/wallet.service';

describe('MarketplaceSellComponent', () => {
  let component: MarketplaceSellComponent;
  let fixture: ComponentFixture<MarketplaceSellComponent>;

  beforeEach(async () => {
    const apiService = {
      getBonds: jasmine.createSpy('getBonds').and.returnValue(of({ data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 1 } })),
      listBondTokens: jasmine.createSpy('listBondTokens').and.returnValue(of({ id: 1 })),
    };

    await TestBed.configureTestingModule({
      imports: [MarketplaceSellComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: apiService },
        { provide: WalletService, useValue: { isConnected: signal(false), address: signal(null) } },
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(MarketplaceSellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('loads available bonds for the listing form', () => {
    expect(component.bonds()).toEqual([]);
  });

  it('has a valid default listing form', () => {
    expect(component.form.get('quoteAsset')?.value).toBe('USDC');
    expect(component.form.valid).toBe(false);
  });
});
