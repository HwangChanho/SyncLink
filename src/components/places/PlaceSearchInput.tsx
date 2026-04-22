/**
 * PlaceSearchInput — autocomplete input for location selection.
 *
 * Features:
 *  - TextInput with 300ms debounce to limit API calls
 *  - Dropdown list of suggestions below the input
 *  - Calls onPlaceSelect(location: string) when the user picks a result
 *  - Uses Google Places Autocomplete (via placesService.ts)
 *  - Session token management (new UUID per user focus session)
 *
 * Usage:
 *  ```tsx
 *  <PlaceSearchInput
 *    value={location}
 *    onPlaceSelect={(loc) => setLocation(loc)}
 *  />
 *  ```
 *
 * TASK-901 (Sprint 9)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  searchPlaces,
  type PlaceSuggestion,
} from '@/services/placesService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlaceSearchInputProps {
  /** Current location value (controlled). */
  value: string;
  /**
   * Called when the user selects a suggestion.
   * Receives the formatted address string.
   */
  onPlaceSelect: (location: string) => void;
  /** Optional placeholder text (overrides i18n default). */
  placeholder?: string;
  /** Additional style for the input container. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
}

// ─── Debounce hook ────────────────────────────────────────────────────────────

/**
 * Debounce hook — returns a debounced version of `value` delayed by `delay` ms.
 * Used to limit Places API calls while the user is still typing.
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ─── UUID helper ──────────────────────────────────────────────────────────────

/**
 * Generate a simple UUID v4 for Places API session tokens.
 * Does not require the `uuid` package — avoids an extra dependency.
 */
function generateSessionToken(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PlaceSearchInput({
  value,
  onPlaceSelect,
  placeholder,
  style,
}: PlaceSearchInputProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  /** Local text state — separate from `value` so typing feels immediate. */
  const [inputText, setInputText] = useState(value);
  /** Whether the dropdown is visible. */
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  /** Current autocomplete suggestions. */
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  /** True while fetching suggestions. */
  const [isSearching, setIsSearching] = useState(false);

  /**
   * Session token for billing grouping.
   * A new token is created each time the user focuses the input.
   */
  const sessionTokenRef = useRef<string>(generateSessionToken());

  /** Debounced query — only triggers a fetch after 300ms of typing inactivity. */
  const debouncedQuery = useDebounce(inputText, 300);

  // Sync external value changes (e.g., clearing the field from parent)
  useEffect(() => {
    if (value !== inputText) {
      setInputText(value);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Fetch suggestions whenever the debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery === value) {
      // Don't search if the query is empty or already the confirmed selection
      setSuggestions([]);
      setIsDropdownOpen(false);
      return;
    }

    let cancelled = false;

    const fetchSuggestions = async () => {
      setIsSearching(true);
      try {
        const results = await searchPlaces(debouncedQuery, sessionTokenRef.current);
        if (!cancelled) {
          setSuggestions(results);
          setIsDropdownOpen(results.length > 0);
        }
      } catch {
        if (!cancelled) {
          setSuggestions([]);
          setIsDropdownOpen(false);
        }
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    };

    void fetchSuggestions();
    return () => { cancelled = true; };
  }, [debouncedQuery, value]);

  /** Handle input focus — generate a fresh session token for this typing session. */
  const handleFocus = useCallback(() => {
    sessionTokenRef.current = generateSessionToken();
  }, []);

  /** Handle suggestion selection — call parent callback and close dropdown. */
  const handleSelect = useCallback((suggestion: PlaceSuggestion) => {
    const location = suggestion.description;
    setInputText(location);
    setSuggestions([]);
    setIsDropdownOpen(false);
    Keyboard.dismiss();
    onPlaceSelect(location);
  }, [onPlaceSelect]);

  /** Handle text change — update local state, clear suggestions if input cleared. */
  const handleChangeText = useCallback((text: string) => {
    setInputText(text);
    if (!text.trim()) {
      setSuggestions([]);
      setIsDropdownOpen(false);
      onPlaceSelect('');
    }
  }, [onPlaceSelect]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, style]}>
      {/* Search input */}
      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={handleChangeText}
          onFocus={handleFocus}
          placeholder={placeholder ?? t('places.search_placeholder')}
          placeholderTextColor={colors.textPlaceholder}
          returnKeyType="done"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {/* Loading indicator inside the input */}
        {isSearching && (
          <ActivityIndicator
            size="small"
            color={colors.primary}
            style={styles.inputSpinner}
          />
        )}
      </View>

      {/* Suggestions dropdown */}
      {isDropdownOpen && suggestions.length > 0 && (
        <View style={styles.dropdown}>
          <FlatList
            data={suggestions}
            keyExtractor={(item) => item.placeId}
            keyboardShouldPersistTaps="always"
            scrollEnabled={suggestions.length > 4}
            // Show at most 4 rows before scrolling
            style={{ maxHeight: 220 }}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                style={[
                  styles.suggestionItem,
                  index === 0 && styles.suggestionItemFirst,
                  index === suggestions.length - 1 && styles.suggestionItemLast,
                ]}
                onPress={() => handleSelect(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.suggestionMain} numberOfLines={1}>
                  {item.mainText}
                </Text>
                {item.secondaryText ? (
                  <Text style={styles.suggestionSecondary} numberOfLines={1}>
                    {item.secondaryText}
                  </Text>
                ) : null}
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.emptyRow}>
                <Text style={styles.emptyText}>{t('places.no_results')}</Text>
              </View>
            }
          />
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      position: 'relative',
      zIndex: 100,
    },
    inputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.inputBackground,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
    },
    input: {
      ...textStyles.body,
      color: colors.textPrimary,
      flex: 1,
      paddingVertical: spacing[2],
    },
    inputSpinner: {
      marginLeft: spacing[2],
    },
    dropdown: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      // Shadow (iOS)
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      // Elevation (Android)
      elevation: 8,
      marginTop: spacing[1],
    },
    suggestionItem: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      backgroundColor: colors.surface,
    },
    suggestionItemFirst: {
      borderTopLeftRadius: radius.md,
      borderTopRightRadius: radius.md,
    },
    suggestionItemLast: {
      borderBottomLeftRadius: radius.md,
      borderBottomRightRadius: radius.md,
    },
    suggestionMain: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    suggestionSecondary: {
      ...textStyles.caption,
      color: colors.textTertiary,
      marginTop: spacing[0.5],
    },
    separator: {
      height: 1,
      backgroundColor: colors.border,
      marginHorizontal: spacing[4],
    },
    emptyRow: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    emptyText: {
      ...textStyles.body,
      color: colors.textTertiary,
    },
  });
}
