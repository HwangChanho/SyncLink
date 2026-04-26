/**
 * Weather service — OpenWeatherMap Current Weather API.
 *
 * Architecture:
 *  - All weather API calls are made here (service layer boundary).
 *  - API key is read from EXPO_PUBLIC_WEATHER_API_KEY (client-side env var).
 *  - Returns a WeatherData object with Ionicons icon name for display.
 *
 * OpenWeatherMap icon → Ionicons mapping:
 *  Thunderstorm (2xx) → thunderstorm
 *  Drizzle      (3xx) → rainy-outline
 *  Rain         (5xx) → rainy
 *  Snow         (6xx) → snow
 *  Atmosphere   (7xx) → cloudy-outline
 *  Clear        (800) → sunny
 *  Clouds       (80x) → cloudy / partly-sunny
 *
 * TASK-903 (Sprint 9)
 */

import i18next from 'i18next';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Weather data returned to UI components. */
export interface WeatherData {
  /** Temperature in Celsius. */
  temp: number;
  /** Short description (e.g. "Sunny", "Light rain"). */
  description: string;
  /**
   * Ionicons icon name matching the weather condition.
   * See full list: https://icons.expo.fyi/
   */
  icon: string;
  /** City / locality name (e.g. "Seoul"). */
  city: string;
}

/** Air quality payload — separate endpoint, combined client-side. */
export interface AirQualityData {
  /** µg/m³ of PM2.5 fine particulates. */
  pm25: number;
  /** Human-readable grade keyed to our i18n bucket. */
  grade: 'good' | 'fair' | 'moderate' | 'poor' | 'very_poor';
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** OpenWeatherMap Current Weather endpoint. */
const WEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';

/**
 * Map an i18next BCP-47 locale to OpenWeatherMap's `lang` parameter.
 * Only a handful of our supported locales differ from OWM codes.
 */
function mapLangForOWM(locale: string): string {
  const lower = locale.toLowerCase();
  if (lower.startsWith('ko')) return 'ko';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('zh')) return 'zh_cn';
  return 'en';
}

/** Default location — Seoul, South Korea — used when GPS is unavailable. */
export const DEFAULT_LAT = 37.5665;
export const DEFAULT_LON = 126.9780;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the OpenWeatherMap API key from environment.
 * Throws if the key is missing.
 */
function getApiKey(): string {
  const key = process.env.EXPO_PUBLIC_WEATHER_API_KEY;
  if (!key) {
    throw new Error(
      'EXPO_PUBLIC_WEATHER_API_KEY is not set. ' +
      'Add it to your .env file and restart the dev server.',
    );
  }
  return key;
}

/**
 * Map an OpenWeatherMap weather condition ID to an Ionicons icon name.
 *
 * @param conditionId - OpenWeatherMap condition code (e.g. 800 = Clear sky)
 * @param isDay       - True if daytime (icon variant differs for day/night)
 * @returns Ionicons icon name string
 */
function mapConditionToIcon(conditionId: number, isDay: boolean): string {
  if (conditionId >= 200 && conditionId < 300) {
    return 'thunderstorm-outline';          // Thunderstorm
  }
  if (conditionId >= 300 && conditionId < 400) {
    return 'rainy-outline';                 // Drizzle
  }
  if (conditionId >= 500 && conditionId < 600) {
    return 'rainy';                         // Rain
  }
  if (conditionId >= 600 && conditionId < 700) {
    return 'snow';                          // Snow
  }
  if (conditionId >= 700 && conditionId < 800) {
    return 'cloudy-outline';                // Atmosphere (mist, fog, haze…)
  }
  if (conditionId === 800) {
    return isDay ? 'sunny' : 'moon-outline'; // Clear sky
  }
  if (conditionId === 801 || conditionId === 802) {
    return isDay ? 'partly-sunny' : 'cloudy-night-outline'; // Few / scattered clouds
  }
  return 'cloudy';                          // Broken / overcast clouds (803, 804)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch the current weather for the given coordinates.
 *
 * @param lat - Latitude in decimal degrees
 * @param lon - Longitude in decimal degrees
 * @returns WeatherData for display in WeatherWidget
 * @throws On network error or API error response
 */
export async function getCurrentWeather(lat: number, lon: number): Promise<WeatherData> {
  const key = getApiKey();

  // OpenWeatherMap language codes: ko / en / ja / zh_cn.
  // Read directly from the i18next package — `i18next.language` reflects
  // whatever locale our /lib/i18n bootstrapped, with no dependency cycle.
  const lang = mapLangForOWM(i18next.language ?? 'en');

  const params = new URLSearchParams({
    lat:   lat.toString(),
    lon:   lon.toString(),
    appid: key,
    units: 'metric',
    lang,
  });

  const response = await fetch(`${WEATHER_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Weather API request failed: ${response.status}`);
  }

  const json = (await response.json()) as {
    name: string;
    main: { temp: number };
    weather: { id: number; description: string }[];
    sys: { sunrise: number; sunset: number };
    dt: number;
  };

  const condition = json.weather[0];
  if (!condition) {
    throw new Error('Weather API returned an empty weather array.');
  }

  // Determine day/night for icon variant
  const isDay = json.dt >= json.sys.sunrise && json.dt < json.sys.sunset;

  return {
    temp:        Math.round(json.main.temp),
    description: condition.description,
    icon:        mapConditionToIcon(condition.id, isDay),
    city:        json.name,
  };
}

/**
 * Fetch current air quality for the given coordinates. Uses OpenWeatherMap's
 * free Air Pollution endpoint. Returns `null` on failure so the widget can
 * simply hide the row instead of surfacing an error.
 */
export async function getCurrentAirQuality(
  lat: number,
  lon: number,
): Promise<AirQualityData | null> {
  const key = process.env.EXPO_PUBLIC_WEATHER_API_KEY;
  if (!key) return null;
  try {
    const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${key}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const json = (await response.json()) as {
      list?: {
        main: { aqi: number };
        components: { pm2_5: number };
      }[];
    };
    const entry = json.list?.[0];
    if (!entry) return null;
    // Map OWM's 1..5 AQI scale to our 5 labelled buckets so the UI can
    // render '좋음' / '보통' / '나쁨' / '아주 나쁨' etc.
    const gradeMap: Record<number, AirQualityData['grade']> = {
      1: 'good',
      2: 'fair',
      3: 'moderate',
      4: 'poor',
      5: 'very_poor',
    };
    return {
      pm25: Math.round(entry.components.pm2_5),
      grade: gradeMap[entry.main.aqi] ?? 'moderate',
    };
  } catch {
    return null;
  }
}
