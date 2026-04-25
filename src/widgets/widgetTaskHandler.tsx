/**
 * widgetTaskHandler — entry point react-native-android-widget invokes
 * whenever Android needs to render or update a widget instance.
 *
 * Lifecycle events (from the package):
 *   - WIDGET_ADDED          : a new widget was placed on the home screen
 *   - WIDGET_UPDATE         : Android requested a periodic refresh
 *   - WIDGET_RESIZED        : user resized the widget
 *   - WIDGET_DELETED        : last instance removed (cleanup hook)
 *   - WIDGET_CLICK          : ignored — widgets are read-only for v1
 *
 * For all render events we read the latest snapshot from AsyncStorage
 * (mirrored there by widgetDataService.refreshWidgetData) and hand it to
 * <SyncLinkWidget />. Reading from AsyncStorage rather than a network
 * source keeps the headless task fast and offline-tolerant.
 *
 * Sprint 19 TASK-1900.
 */

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SyncLinkWidget } from './SyncLinkWidget';
import { WIDGET_DATA_KEY, type WidgetSnapshot } from '@/services/widgetDataService';

const NAME_TO_COMPONENT = {
  SyncLinkWidget: SyncLinkWidget,
} as const;

type WidgetName = keyof typeof NAME_TO_COMPONENT;

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const widgetInfo = props.widgetInfo;
  const Component = NAME_TO_COMPONENT[widgetInfo.widgetName as WidgetName];
  if (!Component) return; // unknown widget — ignore

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(
        <Component
          snapshot={await loadSnapshot()}
          width={widgetInfo.width}
          height={widgetInfo.height}
        />,
      );
      break;
    case 'WIDGET_DELETED':
    case 'WIDGET_CLICK':
    default:
      // No-op — v1 widget is read-only.
      break;
  }
}

/** Load the JSON snapshot from AsyncStorage; returns null on miss / parse fail. */
async function loadSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(WIDGET_DATA_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WidgetSnapshot;
  } catch {
    return null;
  }
}
