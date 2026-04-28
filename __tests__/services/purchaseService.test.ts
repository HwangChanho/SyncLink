/**
 * __tests__/services/purchaseService.test.ts
 *
 * TASK-810: purchaseService.ts 유닛 테스트
 *
 * 전략:
 *  - react-native-purchases를 jest.mock으로 완전 대체 → 실제 StoreKit/Billing 호출 차단
 *  - Platform.OS를 jest.spyOn으로 제어 → iOS/Android 분기 테스트
 *  - jest.setup.js의 global mock을 각 테스트에서 필요에 따라 override
 *
 * 커버리지:
 *  initializePurchases — iOS/Android API 키 분기, configure 호출 확인
 *  getOfferings        — 정상 반환, current null 시 빈 배열
 *  purchasePackage     — pro entitlement 있으면 true, 없으면 false
 *  restorePurchases    — pro entitlement 있으면 true, 없으면 false
 *  checkProStatus      — getCustomerInfo 호출 확인, entitlement 상태 반환
 *
 * @task TASK-810
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

// react-native-purchases mock은 jest.setup.js에서 전역으로 설정되어 있음.
// 각 테스트에서 jest.mocked()를 통해 반환값을 override한다.

// ─── Imports ──────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import type { PurchasesPackage } from 'react-native-purchases';
import {
  initializePurchases,
  getOfferings,
  purchasePackage,
  restorePurchases,
  checkProStatus,
} from '@/services/purchaseService';

// ─── 공통 픽스처 ──────────────────────────────────────────────────────────────

/** 활성 pro entitlement를 가진 CustomerInfo mock */
const mockCustomerInfoWithPro = {
  entitlements: {
    active: {
      pro: {
        identifier: 'pro',
        isActive: true,
      },
    },
  },
};

/** pro entitlement가 없는 CustomerInfo mock */
const mockCustomerInfoNoPro = {
  entitlements: {
    active: {},
  },
};

/** 월간 패키지 mock (PurchasesPackage 최소 형태) */
const mockMonthlyPackage: Partial<PurchasesPackage> = {
  identifier: '$rc_monthly',
  packageType: 'MONTHLY',
  product: {
    identifier: 'com.syncday.monthly',
    title: 'SyncDay Pro 월간',
    description: '월간 구독',
    price: 3900,
    priceString: '₩3,900',
    currencyCode: 'KRW',
  } as PurchasesPackage['product'],
};

/** 연간 패키지 mock */
const mockAnnualPackage: Partial<PurchasesPackage> = {
  identifier: '$rc_annual',
  packageType: 'ANNUAL',
  product: {
    identifier: 'com.syncday.annual',
    title: 'SyncDay Pro 연간',
    description: '연간 구독',
    price: 29900,
    priceString: '₩29,900',
    currencyCode: 'KRW',
  } as PurchasesPackage['product'],
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('purchaseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // initializePurchases
  // ══════════════════════════════════════════════════════════════════════════

  describe('initializePurchases', () => {
    it('iOS에서 iOS API 키로 configure 호출', async () => {
      // Platform.OS를 'ios'로 설정
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

      await initializePurchases('user-ios-123');

      // setLogLevel이 ERROR로 호출되었는지 확인 (운영 환경 최소 로그)
      expect(Purchases.setLogLevel).toHaveBeenCalledWith(LOG_LEVEL.ERROR);

      // configure가 appUserID와 함께 호출되었는지 확인
      expect(Purchases.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          appUserID: 'user-ios-123',
        }),
      );
    });

    it('Android에서 Android API 키로 configure 호출', async () => {
      // Platform.OS를 'android'로 설정
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

      await initializePurchases('user-android-456');

      expect(Purchases.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          appUserID: 'user-android-456',
        }),
      );
    });

    it('configure가 정확히 1회 호출됨', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

      await initializePurchases('user-test-789');

      expect(Purchases.configure).toHaveBeenCalledTimes(1);
    });

    it('configure가 Promise를 반환하며 reject 시 에러 전파', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      const configureError = new Error('RevenueCat initialization failed');
      (Purchases.configure as jest.Mock).mockRejectedValueOnce(configureError);

      await expect(initializePurchases('user-test')).rejects.toThrow(
        'RevenueCat initialization failed',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getOfferings
  // ══════════════════════════════════════════════════════════════════════════

  describe('getOfferings', () => {
    it('current offering의 availablePackages 반환', async () => {
      (Purchases.getOfferings as jest.Mock).mockResolvedValueOnce({
        current: {
          availablePackages: [mockMonthlyPackage, mockAnnualPackage],
        },
      });

      const packages = await getOfferings();

      expect(Purchases.getOfferings).toHaveBeenCalledTimes(1);
      expect(packages).toHaveLength(2);
      expect(packages[0]).toEqual(mockMonthlyPackage);
      expect(packages[1]).toEqual(mockAnnualPackage);
    });

    it('current offering null 시 빈 배열 반환', async () => {
      // RevenueCat 대시보드에 default offering이 없는 경우
      (Purchases.getOfferings as jest.Mock).mockResolvedValueOnce({
        current: null,
      });

      const packages = await getOfferings();

      expect(packages).toEqual([]);
    });

    it('availablePackages가 undefined이면 빈 배열 반환', async () => {
      (Purchases.getOfferings as jest.Mock).mockResolvedValueOnce({
        current: {
          availablePackages: undefined,
        },
      });

      const packages = await getOfferings();

      expect(packages).toEqual([]);
    });

    it('getOfferings SDK 에러 시 에러 전파', async () => {
      const sdkError = new Error('Network error fetching offerings');
      (Purchases.getOfferings as jest.Mock).mockRejectedValueOnce(sdkError);

      await expect(getOfferings()).rejects.toThrow('Network error fetching offerings');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // purchasePackage
  // ══════════════════════════════════════════════════════════════════════════

  describe('purchasePackage', () => {
    it('pro entitlement 활성화 시 true 반환', async () => {
      (Purchases.purchasePackage as jest.Mock).mockResolvedValueOnce({
        customerInfo: mockCustomerInfoWithPro,
      });

      const result = await purchasePackage(mockMonthlyPackage as PurchasesPackage);

      expect(Purchases.purchasePackage).toHaveBeenCalledWith(mockMonthlyPackage);
      expect(result).toBe(true);
    });

    it('pro entitlement 없으면 false 반환', async () => {
      // 구매는 성공했지만 RC 대시보드 설정 오류로 entitlement가 없는 경우
      (Purchases.purchasePackage as jest.Mock).mockResolvedValueOnce({
        customerInfo: mockCustomerInfoNoPro,
      });

      const result = await purchasePackage(mockAnnualPackage as PurchasesPackage);

      expect(result).toBe(false);
    });

    it('purchasePackage SDK 에러 시 에러 전파 (사용자 취소 등)', async () => {
      const purchaseError = new Error('User cancelled the purchase');
      (Purchases.purchasePackage as jest.Mock).mockRejectedValueOnce(purchaseError);

      await expect(
        purchasePackage(mockMonthlyPackage as PurchasesPackage),
      ).rejects.toThrow('User cancelled the purchase');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // restorePurchases
  // ══════════════════════════════════════════════════════════════════════════

  describe('restorePurchases', () => {
    it('복원 후 pro entitlement 있으면 true 반환', async () => {
      (Purchases.restorePurchases as jest.Mock).mockResolvedValueOnce(
        mockCustomerInfoWithPro,
      );

      const result = await restorePurchases();

      expect(Purchases.restorePurchases).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('복원했지만 pro entitlement 없으면 false 반환', async () => {
      // 구매 내역은 없지만 복원은 성공한 경우
      (Purchases.restorePurchases as jest.Mock).mockResolvedValueOnce(
        mockCustomerInfoNoPro,
      );

      const result = await restorePurchases();

      expect(result).toBe(false);
    });

    it('restorePurchases SDK 에러 시 에러 전파', async () => {
      const restoreError = new Error('Restore purchases failed — network error');
      (Purchases.restorePurchases as jest.Mock).mockRejectedValueOnce(restoreError);

      await expect(restorePurchases()).rejects.toThrow(
        'Restore purchases failed — network error',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // checkProStatus
  // ══════════════════════════════════════════════════════════════════════════

  describe('checkProStatus', () => {
    it('pro entitlement 활성화 시 true 반환', async () => {
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce(
        mockCustomerInfoWithPro,
      );

      const result = await checkProStatus();

      expect(Purchases.getCustomerInfo).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('pro entitlement 없으면 false 반환 (무료 플랜 유저)', async () => {
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce(
        mockCustomerInfoNoPro,
      );

      const result = await checkProStatus();

      expect(result).toBe(false);
    });

    it('getCustomerInfo SDK 에러 시 에러 전파', async () => {
      const infoError = new Error('Customer info fetch failed');
      (Purchases.getCustomerInfo as jest.Mock).mockRejectedValueOnce(infoError);

      await expect(checkProStatus()).rejects.toThrow('Customer info fetch failed');
    });

    it('getCustomerInfo가 정확히 1회만 호출됨', async () => {
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce(
        mockCustomerInfoNoPro,
      );

      await checkProStatus();

      expect(Purchases.getCustomerInfo).toHaveBeenCalledTimes(1);
    });
  });
});
