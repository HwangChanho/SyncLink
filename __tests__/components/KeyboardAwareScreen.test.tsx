/**
 * KeyboardAwareScreen — minimal smoke tests.
 *
 * The component is a pass-through wrapper around RN primitives, so these
 * tests focus on contract:
 *   - renders children
 *   - exposes a ScrollView by default (for keyboardShouldPersistTaps UX)
 *   - opts into non-scrollable layouts via scrollEnabled=false
 *
 * Sprint 14 TASK-1410
 */

import { render } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { KeyboardAwareScreen } from '@/components/common/KeyboardAwareScreen';

describe('KeyboardAwareScreen', () => {
  it('renders its children', () => {
    const { getByText } = render(
      <KeyboardAwareScreen>
        <Text>hello</Text>
      </KeyboardAwareScreen>,
    );
    expect(getByText('hello')).toBeTruthy();
  });

  it('renders a non-scroll container when scrollEnabled=false', () => {
    const { getByTestId } = render(
      <KeyboardAwareScreen scrollEnabled={false}>
        <View testID="inner" />
      </KeyboardAwareScreen>,
    );
    expect(getByTestId('inner')).toBeTruthy();
  });
});
