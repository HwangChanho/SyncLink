/**
 * WeatherWidget — displays current weather on the home screen.
 *
 * Features:
 *  - Requests device location via expo-location (when permission granted)
 *  - Falls back to Seoul (37.5665, 126.9780) when location is unavailable
 *  - Fetches weather from OpenWeatherMap via weatherService.ts
 *  - Shows temperature + Ionicons weather icon + city name
 *  - Graceful loading / error states
 *
 * TASK-903 (Sprint 9)
 */

import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  getCurrentWeather,
  getCurrentAirQuality,
  type WeatherData,
  type AirQualityData,
  DEFAULT_LAT,
  DEFAULT_LON,
} from '@/services/weatherService';

// ─── Component ────────────────────────────────────────────────────────────────

export function WeatherWidget() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [air, setAir] = useState<AirQualityData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const fetchWeather = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);

    try {
      let lat = DEFAULT_LAT;
      let lon = DEFAULT_LON;

      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status === 'granted') {
        // Step 1: take any last-known fix immediately so we render *something*
        // even on a cold start.
        const last = await Location.getLastKnownPositionAsync({});
        if (last) {
          lat = last.coords.latitude;
          lon = last.coords.longitude;
        }

        // Step 2: force a fresh high-accuracy fix. Balanced mode was returning
        // stale cached positions (carrier-tower resolution) so the widget
        // kept showing the wrong city. High accuracy hits the GPS.
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          lat = loc.coords.latitude;
          lon = loc.coords.longitude;
        } catch {
          // Keep the last-known fix if the GPS request fails (e.g. indoors).
        }
      }

      const [data, airData] = await Promise.all([
        getCurrentWeather(lat, lon),
        getCurrentAirQuality(lat, lon),
      ]);
      setWeather(data);
      setAir(airData);
    } catch {
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchWeather();
  }, [fetchWeather]);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>{t('weather.loading')}</Text>
      </View>
    );
  }

  if (hasError || !weather) {
    return (
      <View style={styles.container}>
        <Ionicons name="cloud-offline-outline" size={20} color={colors.textTertiary} />
        <Text style={styles.unavailableText}>{t('weather.unavailable')}</Text>
      </View>
    );
  }

  return (
    // Tap the widget to re-query GPS and refetch weather — useful when
    // the cached location is stale (e.g. user has travelled since the
    // last launch).
    <Pressable
      style={styles.container}
      onPress={() => void fetchWeather()}
      accessibilityLabel="날씨 새로고침"
    >
      {/* Row 1 — temperature + current conditions */}
      <View style={styles.row}>
        <Ionicons
          name={weather.icon as keyof typeof Ionicons.glyphMap}
          size={24}
          color={colors.primary}
        />
        <Text style={styles.temp}>{weather.temp}°</Text>
        <Text style={styles.city} numberOfLines={1}>{weather.city}</Text>
        <Text style={styles.description} numberOfLines={1}>{weather.description}</Text>
      </View>

      {/* Row 2 — air quality (PM2.5). Hidden when the AQ endpoint didn't
          return data so the card stays compact in those cases. */}
      {air && (
        <View style={styles.airRow}>
          <Ionicons
            name="leaf-outline"
            size={14}
            color={airColor(air.grade, colors)}
          />
          <Text style={styles.airLabel}>{t('weather.air_pm25')}</Text>
          <Text style={styles.airValue}>{air.pm25} ㎍/㎥</Text>
          <View
            style={[
              styles.airBadge,
              { backgroundColor: airColor(air.grade, colors) + '22', borderColor: airColor(air.grade, colors) },
            ]}
          >
            <Text style={[styles.airBadgeText, { color: airColor(air.grade, colors) }]}>
              {t(`weather.grade_${air.grade}`)}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** Colour per AQI grade — matches common dust-forecast palettes (green→red). */
function airColor(
  grade: AirQualityData['grade'],
  colors: ReturnType<typeof useColors>,
): string {
  switch (grade) {
    case 'good':      return '#22C55E';
    case 'fair':      return '#84CC16';
    case 'moderate':  return '#EAB308';
    case 'poor':      return '#F97316';
    case 'very_poor': return '#DC2626';
    default:          return colors.textSecondary;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      // Now a column so an optional second row (air quality) can sit below.
      flexDirection: 'column',
      gap: 4,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      marginHorizontal: spacing[4],
      marginTop: spacing[2],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
    },
    airRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    airLabel: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
    airValue: {
      ...textStyles.caption,
      color: colors.textPrimary,
      fontWeight: '600',
    },
    airBadge: {
      marginLeft: 'auto',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      borderWidth: 1,
    },
    airBadgeText: {
      ...textStyles.caption,
      fontWeight: '600',
    },
    loadingText: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
    unavailableText: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
    temp: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
      fontWeight: '700',
    },
    city: {
      ...textStyles.label,
      color: colors.textSecondary,
      flex: 1,
    },
    description: {
      ...textStyles.caption,
      color: colors.textTertiary,
      textTransform: 'capitalize',
    },
  });
}
