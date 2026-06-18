/**
 * linkText — render free-form text with tappable URLs.
 *
 * Used by Space chat message bubbles: when a member sends a message containing
 * a URL, the URL becomes tappable. Tapping shows a warning (the link is
 * user-supplied / untrusted) and, on confirm, opens it in an in-app browser
 * (native) or a new tab (web).
 *
 * Kept generic (not chat-specific) so notes / other surfaces can reuse it.
 */

import { Text, Platform, Linking, type StyleProp, type TextStyle } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { showAlert } from '@/lib/webAlert';

/**
 * Matches http(s) URLs. Stops at whitespace and a few wrapping characters so a
 * trailing ")" or ">" around a pasted link isn't swallowed into the URL.
 * Global + case-insensitive so we can walk every match in a string.
 */
const URL_RE = /https?:\/\/[^\s<>()]+/gi;

/** A single run of the original text: either plain text or a URL. */
interface TextSegment {
  value: string;
  isUrl: boolean;
}

/**
 * Split text into alternating plain-text / URL segments, preserving order and
 * the exact original characters (so concatenating all `value`s rebuilds the
 * input). A fresh RegExp is created per call because `URL_RE` is stateful
 * (the global flag carries `lastIndex`).
 *
 * @param text - arbitrary message body
 */
export function splitTextByUrl(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const re = new RegExp(URL_RE.source, 'gi');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ value: text.slice(lastIndex, match.index), isUrl: false });
    }
    segments.push({ value: match[0], isUrl: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ value: text.slice(lastIndex), isUrl: false });
  }
  return segments;
}

interface LinkifiedTextProps {
  /** The message body to render. */
  text: string;
  /** Style applied to the outer Text (the whole paragraph). */
  style?: StyleProp<TextStyle>;
  /** Style applied to URL runs (e.g. underline). Color is inherited so links
   *  stay legible on both light and accent-colored bubbles. */
  linkStyle?: StyleProp<TextStyle>;
}

/**
 * Render `text` with any URLs as tappable links guarded by a warning dialog.
 * When the text has no URL it renders as a plain Text (fast path).
 */
export function LinkifiedText({ text, style, linkStyle }: LinkifiedTextProps) {
  const { t } = useTranslation();
  const segments = splitTextByUrl(text);

  // Fast path: no links → plain text, no per-segment Text nodes.
  if (segments.length === 1 && !segments[0]?.isUrl) {
    return <Text style={style}>{text}</Text>;
  }

  // Warn before navigating away — the link is user-supplied and untrusted.
  const onPressUrl = (url: string) => {
    showAlert(
      t('common.link_warning_title'),
      t('common.link_warning_message', { url }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.link_open'),
          onPress: () => {
            // Web: open a new tab. Native: in-app browser (SFSafariVC /
            // Chrome Custom Tab) so the user stays inside the app.
            if (Platform.OS === 'web') {
              void Linking.openURL(url).catch(() => {/* ignore */});
            } else {
              void WebBrowser.openBrowserAsync(url).catch(() => {/* ignore */});
            }
          },
        },
      ],
    );
  };

  return (
    <Text style={style}>
      {segments.map((seg, i) =>
        seg.isUrl ? (
          <Text key={i} style={linkStyle} onPress={() => onPressUrl(seg.value)}>
            {seg.value}
          </Text>
        ) : (
          <Text key={i}>{seg.value}</Text>
        ),
      )}
    </Text>
  );
}
