/**
 * AppErrorBoundary — React error boundary with Supabase error_logs sink.
 *
 * Catches rendering errors below this point and reports them to the server
 * via logError so we can correlate user crash reports with a stack trace.
 * Falls back to a minimal "다시 시도" UI so the user can recover without
 * killing the app.
 *
 * Wrap *risky* subtrees (e.g. the planner tab) rather than the whole app —
 * a boundary that's too high re-mounts everything on every recoverable
 * error.
 *
 * TODO (출시 정리): 안정화되면 로그 verbosity 를 줄이고 ErrorBoundary 만
 * 유지. 지금은 단계별 mount/render 진단을 위해 부가 컨텍스트를 함께 기록.
 */

import { Component, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { logError } from '@/lib/errorLogger';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

interface Props {
  children: ReactNode;
  /** Short identifier so we can tell which boundary fired. */
  area: string;
  /** Optional override of the fallback UI. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: null };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, errorMessage: err.message };
  }

  componentDidCatch(err: Error, info: { componentStack: string }) {
    // Best-effort report — failure here must not retrigger the boundary.
    logError({
      context: `boundary.${this.props.area}`,
      error: err,
      details: {
        componentStack: info.componentStack?.slice(0, 1500),
      },
    }).catch(() => { /* swallow */ });
    // Also surface to the device console so Console.app picks it up.
    console.error(`[boundary:${this.props.area}]`, err, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>화면을 표시하지 못했어요</Text>
        <Text style={styles.body}>
          {this.state.errorMessage ?? '알 수 없는 오류'}
        </Text>
        <Pressable style={styles.retry} onPress={this.handleRetry}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
  },
  title: {
    ...(textStyles.h2 as object),
    marginBottom: spacing[2],
  },
  body: {
    ...(textStyles.body as object),
    color: '#888',
    textAlign: 'center',
    marginBottom: spacing[5],
  },
  retry: {
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[6],
    borderRadius: radius.full,
    backgroundColor: '#4A6CF7',
  },
  retryText: {
    ...(textStyles.label as object),
    color: '#fff',
  },
});
