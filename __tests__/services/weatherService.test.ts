/**
 * @task TASK-903 (Sprint 9) — Weather Service tests
 *
 * Tests for weatherService — OpenWeatherMap Current Weather API.
 * All fetch() calls are mocked via global.fetch.
 */

import { getCurrentWeather, DEFAULT_LAT, DEFAULT_LON } from '@/services/weatherService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WEATHER_BASE = 'https://api.openweathermap.org/data/2.5/weather';

interface WeatherResponseOptions {
  conditionId?:  number;
  description?:  string;
  temp?:         number;
  city?:         string;
  dt?:           number;
  sunrise?:      number;
  sunset?:       number;
}

/** Build a minimal OpenWeatherMap API response. */
function makeWeatherResponse(opts: WeatherResponseOptions = {}): unknown {
  return {
    name:    opts.city       ?? 'Seoul',
    main:    { temp: opts.temp ?? 20.4 },
    weather: [{ id: opts.conditionId ?? 800, description: opts.description ?? 'clear sky' }],
    sys:     { sunrise: opts.sunrise ?? 1_000, sunset: opts.sunset ?? 90_000 },
    dt:      opts.dt ?? 50_000,   // daytime by default (1000 < 50000 < 90000)
  };
}

function mockFetch(body: unknown, ok = true, status = 200): void {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('weatherService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as jest.Mock;
  });

  // ── Exported constants ─────────────────────────────────────────────────────

  describe('constants', () => {
    it('exports DEFAULT_LAT for Seoul', () => {
      expect(DEFAULT_LAT).toBe(37.5665);
    });

    it('exports DEFAULT_LON for Seoul', () => {
      expect(DEFAULT_LON).toBeCloseTo(126.978, 3);
    });
  });

  // ── getCurrentWeather ──────────────────────────────────────────────────────

  describe('getCurrentWeather', () => {
    it('returns WeatherData with all required fields', async () => {
      mockFetch(makeWeatherResponse({ temp: 22.7, description: 'clear sky', city: 'Seoul' }));

      const data = await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);

      expect(data).toMatchObject({
        temp:        23,          // Math.round(22.7)
        description: 'clear sky',
        city:        'Seoul',
      });
      expect(typeof data.icon).toBe('string');
    });

    it('includes API key, units=metric and coordinates in request URL', async () => {
      mockFetch(makeWeatherResponse());

      await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);

      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain(WEATHER_BASE);
      expect(url).toMatch(/[?&]appid=[^&]+/);
      expect(url).toContain('units=metric');
      expect(url).toContain(`lat=${DEFAULT_LAT}`);
    });

    it('throws when fetch returns a non-OK HTTP status', async () => {
      mockFetch({}, false, 401);

      await expect(getCurrentWeather(DEFAULT_LAT, DEFAULT_LON)).rejects.toThrow(
        'Weather API request failed: 401',
      );
    });

    it('throws when weather array is empty', async () => {
      mockFetch({
        name:    'Seoul',
        main:    { temp: 20 },
        weather: [],
        sys:     { sunrise: 1000, sunset: 90000 },
        dt:      50000,
      });

      await expect(getCurrentWeather(DEFAULT_LAT, DEFAULT_LON)).rejects.toThrow(
        'Weather API returned an empty weather array.',
      );
    });

    // ── Icon mapping ──────────────────────────────────────────────────────────

    describe('icon mapping', () => {
      it('maps clear sky (800) → sunny during the day', async () => {
        mockFetch(makeWeatherResponse({ conditionId: 800, dt: 50_000, sunrise: 1_000, sunset: 90_000 }));
        const { icon } = await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);
        expect(icon).toBe('sunny');
      });

      it('maps clear sky (800) → moon-outline at night', async () => {
        mockFetch(makeWeatherResponse({ conditionId: 800, dt: 100, sunrise: 1_000, sunset: 90_000 }));
        const { icon } = await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);
        expect(icon).toBe('moon-outline');
      });

      it('maps few clouds (801) → partly-sunny during the day', async () => {
        mockFetch(makeWeatherResponse({ conditionId: 801 }));
        const { icon } = await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);
        expect(icon).toBe('partly-sunny');
      });

      it('maps few clouds (802) → cloudy-night-outline at night', async () => {
        mockFetch(makeWeatherResponse({ conditionId: 802, dt: 100, sunrise: 1_000, sunset: 90_000 }));
        const { icon } = await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);
        expect(icon).toBe('cloudy-night-outline');
      });

      it('maps rain (500) → rainy', async () => {
        mockFetch(makeWeatherResponse({ conditionId: 500 }));
        const { icon } = await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);
        expect(icon).toBe('rainy');
      });

      it('maps thunderstorm (200) → thunderstorm-outline', async () => {
        mockFetch(makeWeatherResponse({ conditionId: 200 }));
        const { icon } = await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);
        expect(icon).toBe('thunderstorm-outline');
      });

      it('maps snow (600) → snow', async () => {
        mockFetch(makeWeatherResponse({ conditionId: 600 }));
        const { icon } = await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);
        expect(icon).toBe('snow');
      });

      it('maps drizzle (300) → rainy-outline', async () => {
        mockFetch(makeWeatherResponse({ conditionId: 300 }));
        const { icon } = await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);
        expect(icon).toBe('rainy-outline');
      });

      it('maps atmosphere/fog (700) → cloudy-outline', async () => {
        mockFetch(makeWeatherResponse({ conditionId: 700 }));
        const { icon } = await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);
        expect(icon).toBe('cloudy-outline');
      });

      it('maps overcast clouds (804) → cloudy', async () => {
        mockFetch(makeWeatherResponse({ conditionId: 804 }));
        const { icon } = await getCurrentWeather(DEFAULT_LAT, DEFAULT_LON);
        expect(icon).toBe('cloudy');
      });
    });
  });
});
