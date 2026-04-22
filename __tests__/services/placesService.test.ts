/**
 * @task TASK-901 (Sprint 9) — Places Service tests
 *
 * Tests for placesService — Google Maps Places Autocomplete & Place Details API.
 * All fetch() calls are mocked via global.fetch.
 */

import { searchPlaces, getPlaceDetails } from '@/services/placesService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AUTOCOMPLETE_BASE = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const DETAILS_BASE      = 'https://maps.googleapis.com/maps/api/place/details/json';

/** Create a mocked fetch response. */
function mockFetch(body: unknown, ok = true, status = 200): void {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('placesService', () => {
  const SESSION_TOKEN = 'session-uuid-abc';

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as jest.Mock;
  });

  // ── searchPlaces ───────────────────────────────────────────────────────────

  describe('searchPlaces', () => {
    it('returns empty array for blank query without calling fetch', async () => {
      const result = await searchPlaces('   ', SESSION_TOKEN);
      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns mapped PlaceSuggestion array on OK response', async () => {
      mockFetch({
        status:      'OK',
        predictions: [
          {
            place_id:     'place-001',
            description:  'Gyeongbokgung Palace, Seoul',
            structured_formatting: {
              main_text:      'Gyeongbokgung Palace',
              secondary_text: 'Seoul, South Korea',
            },
          },
        ],
      });

      const result = await searchPlaces('경복궁', SESSION_TOKEN);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        placeId:       'place-001',
        mainText:      'Gyeongbokgung Palace',
        secondaryText: 'Seoul, South Korea',
        description:   'Gyeongbokgung Palace, Seoul',
      });
    });

    it('returns empty array for ZERO_RESULTS status (not an error)', async () => {
      mockFetch({ status: 'ZERO_RESULTS', predictions: [] });

      const result = await searchPlaces('xyzzy', SESSION_TOKEN);
      expect(result).toEqual([]);
    });

    it('maps missing secondary_text to empty string', async () => {
      mockFetch({
        status:      'OK',
        predictions: [
          {
            place_id:     'place-002',
            description:  'Seoul',
            structured_formatting: { main_text: 'Seoul' },
          },
        ],
      });

      const result = await searchPlaces('Seoul', SESSION_TOKEN);
      expect(result[0]?.secondaryText).toBe('');
    });

    it('includes API key and sessionToken in the request URL', async () => {
      mockFetch({ status: 'OK', predictions: [] });

      await searchPlaces('Seoul', SESSION_TOKEN);

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain(AUTOCOMPLETE_BASE);
      expect(calledUrl).toMatch(/[?&]key=[^&]+/);
      expect(calledUrl).toContain(`sessiontoken=${SESSION_TOKEN}`);
    });

    it('defaults language to ko', async () => {
      mockFetch({ status: 'OK', predictions: [] });

      await searchPlaces('Seoul', SESSION_TOKEN);

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain('language=ko');
    });

    it('respects explicit language parameter', async () => {
      mockFetch({ status: 'OK', predictions: [] });

      await searchPlaces('Seoul', SESSION_TOKEN, 'en');

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain('language=en');
    });

    it('throws when fetch returns a non-OK HTTP status', async () => {
      mockFetch({}, false, 500);

      await expect(searchPlaces('Seoul', SESSION_TOKEN)).rejects.toThrow(
        'Places Autocomplete request failed: 500',
      );
    });

    it('throws on API error status with error_message', async () => {
      mockFetch({ status: 'REQUEST_DENIED', error_message: 'API key invalid' });

      await expect(searchPlaces('Seoul', SESSION_TOKEN)).rejects.toThrow(
        'Places API error: REQUEST_DENIED — API key invalid',
      );
    });

  });

  // ── getPlaceDetails ────────────────────────────────────────────────────────

  describe('getPlaceDetails', () => {
    const PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

    const makeDetailResponse = () => ({
      status: 'OK',
      result: {
        place_id:          PLACE_ID,
        name:              'Gyeongbokgung Palace',
        formatted_address: '161 Sajik-ro, Jongno-gu, Seoul',
        geometry:          { location: { lat: 37.5796, lng: 126.977 } },
      },
    });

    it('returns mapped PlaceDetail on OK response', async () => {
      mockFetch(makeDetailResponse());

      const detail = await getPlaceDetails(PLACE_ID, SESSION_TOKEN);

      expect(detail).toEqual({
        placeId:          PLACE_ID,
        name:             'Gyeongbokgung Palace',
        formattedAddress: '161 Sajik-ro, Jongno-gu, Seoul',
        lat:              37.5796,
        lng:              126.977,
      });
    });

    it('includes place_id, key, and sessionToken in the request URL', async () => {
      mockFetch(makeDetailResponse());

      await getPlaceDetails(PLACE_ID, SESSION_TOKEN);

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain(DETAILS_BASE);
      expect(calledUrl).toContain(`place_id=${PLACE_ID}`);
      expect(calledUrl).toMatch(/[?&]key=[^&]+/);
      expect(calledUrl).toContain(`sessiontoken=${SESSION_TOKEN}`);
    });

    it('throws on non-OK API status with error_message', async () => {
      mockFetch({ status: 'NOT_FOUND', error_message: 'Place not found' });

      await expect(getPlaceDetails(PLACE_ID, SESSION_TOKEN)).rejects.toThrow(
        'Place Details API error: NOT_FOUND — Place not found',
      );
    });

    it('throws when fetch returns a non-OK HTTP status', async () => {
      mockFetch({}, false, 403);

      await expect(getPlaceDetails(PLACE_ID, SESSION_TOKEN)).rejects.toThrow(
        'Place Details request failed: 403',
      );
    });
  });
});
