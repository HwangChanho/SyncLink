/**
 * Event search screen — /search
 *
 * Searches user events by title (case-insensitive) using the
 * existing searchEventsByTitle service function. Results are
 * debounced (300 ms) to avoid excessive Supabase queries while typing.
 *
 * Navigation: accessible via the search icon in the Calendar header.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  searchEventsByTitle,
  type EventAutocompleteSuggestion,
} from '@/services/eventService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Formats lastStartAt as a relative or absolute date string. */
function formatDate(date: Date, locale: string): string {
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 0) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  if (diffDays < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}

// ─── Result row ───────────────────────────────────────────────────────────────

interface ResultRowProps {
  item: EventAutocompleteSuggestion;
  locale: string;
  onPress: () => void;
  colors: ColorTokens;
  styles: ReturnType<typeof makeStyles>;
}

function ResultRow({ item, locale, onPress, colors, styles }: ResultRowProps) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {/* Color bar */}
      <View style={[styles.colorBar, { backgroundColor: item.color ?? colors.primary }]} />

      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
        <View style={styles.rowMeta}>
          {item.location ? (
            <>
              <Ionicons name="location-outline" size={11} color={colors.textTertiary} />
              <Text style={styles.rowMetaText} numberOfLines={1}>{item.location}</Text>
              <Text style={styles.rowMetaSep}>·</Text>
            </>
          ) : null}
          <Text style={styles.rowMetaText}>{formatDate(item.lastStartAt, locale)}</Text>
        </View>
      </View>

      <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EventSearchScreen() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<EventAutocompleteSuggestion[]>([]);
  const [isLoading, setLoading] = useState(false);
  const debounceTimer           = useRef<ReturnType<typeof setTimeout> | null>(null);

  const locale = i18n.language === 'ko' ? 'ko-KR' : i18n.language;

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await searchEventsByTitle(q, 20);
      setResults(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => void runSearch(query), 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, runSearch]);

  // Auto-focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* ── Search bar ── */}
      <View style={styles.searchBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.inputWrap}>
          <Ionicons name="search-outline" size={16} color={colors.textTertiary} style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t('event_search.placeholder')}
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : 'never'}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && Platform.OS !== 'ios' && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Results / hints ── */}
      {isLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : query.trim().length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="search-outline" size={40} color={colors.border} />
          <Text style={styles.hintText}>{t('event_search.hint')}</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="calendar-outline" size={40} color={colors.border} />
          <Text style={styles.hintText}>{t('event_search.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ResultRow
              item={item}
              locale={locale}
              onPress={() => router.push(`/event/${item.id}`)}
              colors={colors}
              styles={styles}
            />
          )}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.background,
    },
    searchBar: {
      flexDirection:   'row',
      alignItems:      'center',
      paddingHorizontal: spacing[3],
      paddingVertical:   spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap:               spacing[2],
    },
    backButton: {
      width:  componentHeight.buttonSm,
      height: componentHeight.buttonSm,
      alignItems:     'center',
      justifyContent: 'center',
    },
    inputWrap: {
      flex:            1,
      flexDirection:   'row',
      alignItems:      'center',
      backgroundColor: colors.inputBackground,
      borderRadius:    radius.md,
      paddingHorizontal: spacing[3],
      paddingVertical:   spacing[1.5],
      gap:               spacing[2],
    },
    searchIcon: {
      flexShrink: 0,
    },
    input: {
      flex:  1,
      ...textStyles.body,
      color: colors.textPrimary,
      paddingVertical: 0,
    },
    centerState: {
      flex:           1,
      alignItems:     'center',
      justifyContent: 'center',
      gap:            spacing[3],
      paddingBottom:  spacing[20],
    },
    hintText: {
      ...textStyles.bodySm,
      color: colors.textTertiary,
    },
    listContent: {
      paddingBottom: spacing[10],
    },
    row: {
      flexDirection:     'row',
      alignItems:        'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor:   colors.surface,
      overflow:          'hidden',
    },
    colorBar: {
      width:     4,
      alignSelf: 'stretch',
    },
    rowContent: {
      flex:            1,
      paddingVertical: spacing[3],
      paddingLeft:     spacing[3],
      paddingRight:    spacing[1],
      gap:             spacing[0.5],
    },
    rowTitle: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    rowMeta: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           spacing[1],
    },
    rowMetaText: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
    rowMetaSep: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
  });
}
