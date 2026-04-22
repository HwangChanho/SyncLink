/**
 * Places service — Google Maps Places Autocomplete & Place Details API.
 *
 * Architecture:
 *  - All Google API calls are made here (service layer boundary).
 *  - Components use PlaceSearchInput, which uses this service internally.
 *  - API key is read from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (client-side env var).
 *
 * Session tokens:
 *  - Google recommends creating a new UUID session token for each autocomplete
 *    session (i.e., each time the user focuses the search input).
 *  - The caller (PlaceSearchInput) is responsible for managing session tokens.
 *
 * TASK-901 (Sprint 9)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single autocomplete suggestion returned by the Places API. */
export interface PlaceSuggestion {
  /** Google's stable place ID — use this to fetch full details. */
  placeId: string;
  /** Short main text (e.g. "Gyeongbokgung Palace"). */
  mainText: string;
  /** Secondary text, typically address (e.g. "Seoul, South Korea"). */
  secondaryText: string;
  /** Full description combining mainText + secondaryText. */
  description: string;
}

/** Detailed information for a specific place. */
export interface PlaceDetail {
  /** Google place ID. */
  placeId: string;
  /** Display name of the place. */
  name: string;
  /** Formatted address string. */
  formattedAddress: string;
  /** Latitude of the place. */
  lat: number;
  /** Longitude of the place. */
  lng: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Google Places Autocomplete API endpoint. */
const AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';

/** Google Place Details API endpoint. */
const PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

/** Fields to request from Place Details (minimises billing cost). */
const DETAIL_FIELDS = 'place_id,name,formatted_address,geometry/location';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the Google Maps API key from environment.
 * Throws a clear error if the key is missing — easier to debug during development.
 */
function getApiKey(): string {
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set. ' +
      'Add it to your .env file and restart the dev server.',
    );
  }
  return key;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search for place suggestions using Google Places Autocomplete.
 *
 * @param query        - User's search query string (at least 1 character)
 * @param sessionToken - UUID token for billing grouping (reuse across calls in one session)
 * @param language     - BCP-47 language code for results (default: 'ko')
 * @returns Array of place suggestions (empty array on empty query or error)
 */
export async function searchPlaces(
  query: string,
  sessionToken: string,
  language = 'ko',
): Promise<PlaceSuggestion[]> {
  if (!query.trim()) return [];

  const key = getApiKey();

  const params = new URLSearchParams({
    input:        query,
    key,
    sessiontoken: sessionToken,
    language,
  });

  const response = await fetch(`${AUTOCOMPLETE_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Places Autocomplete request failed: ${response.status}`);
  }

  const json = (await response.json()) as {
    status: string;
    predictions: Array<{
      place_id: string;
      description: string;
      structured_formatting: {
        main_text: string;
        secondary_text?: string;
      };
    }>;
    error_message?: string;
  };

  // ZERO_RESULTS is a normal non-error status — return an empty array
  if (json.status === 'ZERO_RESULTS') return [];

  if (json.status !== 'OK') {
    throw new Error(
      `Places API error: ${json.status}` +
      (json.error_message ? ` — ${json.error_message}` : ''),
    );
  }

  return json.predictions.map((p) => ({
    placeId:       p.place_id,
    mainText:      p.structured_formatting.main_text,
    secondaryText: p.structured_formatting.secondary_text ?? '',
    description:   p.description,
  }));
}

/**
 * Fetch detailed information for a specific place.
 *
 * @param placeId      - Google place ID from a PlaceSuggestion
 * @param sessionToken - UUID token (same one used for the preceding autocomplete calls)
 * @param language     - BCP-47 language code for results (default: 'ko')
 * @returns PlaceDetail with name, address, and lat/lng coordinates
 */
export async function getPlaceDetails(
  placeId: string,
  sessionToken: string,
  language = 'ko',
): Promise<PlaceDetail> {
  const key = getApiKey();

  const params = new URLSearchParams({
    place_id:     placeId,
    key,
    sessiontoken: sessionToken,
    fields:       DETAIL_FIELDS,
    language,
  });

  const response = await fetch(`${PLACE_DETAILS_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Place Details request failed: ${response.status}`);
  }

  const json = (await response.json()) as {
    status: string;
    result: {
      place_id: string;
      name: string;
      formatted_address: string;
      geometry: {
        location: { lat: number; lng: number };
      };
    };
    error_message?: string;
  };

  if (json.status !== 'OK') {
    throw new Error(
      `Place Details API error: ${json.status}` +
      (json.error_message ? ` — ${json.error_message}` : ''),
    );
  }

  const { result } = json;
  return {
    placeId:          result.place_id,
    name:             result.name,
    formattedAddress: result.formatted_address,
    lat:              result.geometry.location.lat,
    lng:              result.geometry.location.lng,
  };
}
