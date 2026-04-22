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

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { getCurrentWeather, type WeatherData, DEFAULT_LAT, DEFAULT_LON } from '@/services/weatherService';

// ─── Component ────────────────────────────────────────────────────────────────

export function WeatherWidget() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchWeather = async () => {
      setIsLoading(true);
      setHasError(false);

      try {
        let lat = DEFAULT_LAT;
        let lon = DEFAULT_LON;

        // Request location permission
        const { status } = await Location.requestForegroundPermissionsAsync();

        if (status === 'granted') {
          // Use actual device location (low accuracy to minimise battery drain)
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          lat = loc.coords.latitude;
          lon = loc.coords.longitude;
        }
        // If permission denied, lat/lon remain as Seoul defaults

        const data = await getCurrentWeather(lat, lon);
        if (!cancelled) {
          setWeather(data);
        }
      } catch {
        if (!cancelled) {
          setHasError(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchWeather();
    return () => { cancelled = true; };
  }, []);

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
    <View style={styles.container}>
      {/* Weather icon */}
      <Ionicons
        name={weather.icon as keyof typeof Ionicons.glyphMap}
        size={24}
        color={colors.primary}
      />

      {/* Temperature */}
      <Text style={styles.temp}>{weather.temp}°</Text>

      {/* City name */}
      <Text style={styles.city} numberOfLines={1}>{weather.city}</Text>

      {/* Description */}
      <Text style={styles.description} numberOfLines={1}>{weather.description}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      marginHorizontal: spacing[4],
      marginTop: spacing[2],
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
