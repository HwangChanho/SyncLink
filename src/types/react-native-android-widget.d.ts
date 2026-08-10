/**
 * Minimal ambient declarations for react-native-android-widget.
 *
 * The package ships its own types when installed via `npm install`, but
 * we keep this stub in the repo so:
 *   - TypeScript passes on iOS-only / web-only contributors who haven't
 *     run `npm install` since the package was added.
 *   - The exact symbols we use are documented here as the integration
 *     contract.
 *
 * Once the package is installed, these declarations are merged with the
 * package's own .d.ts (TS uses declaration merging for `declare module`).
 *
 * Sprint 19 TASK-1900.
 */

declare module 'react-native-android-widget' {
  import type { ReactElement, ReactNode } from 'react';

  // ─── Widget components ────────────────────────────────────────────────────

  interface FlexWidgetStyle {
    width?:           number | 'match_parent' | 'wrap_content';
    height?:          number | 'match_parent' | 'wrap_content';
    flex?:            number;
    flexDirection?:   'row' | 'column';
    justifyContent?:  'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around';
    alignItems?:      'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
    backgroundColor?: string;
    padding?:         number;
    paddingTop?:      number;
    paddingBottom?:   number;
    paddingLeft?:     number;
    paddingRight?:    number;
    paddingVertical?:   number;
    paddingHorizontal?: number;
    margin?:          number;
    marginTop?:       number;
    marginBottom?:    number;
    marginVertical?:  number;
    marginHorizontal?: number;
    marginRight?:     number;
    marginLeft?:      number;
    borderRadius?:    number;
    borderWidth?:     number;
    borderColor?:     string;
  }

  /**
   * Tap handling, shared by every widget element.
   *
   * `OPEN_APP` and `OPEN_URI` are handled natively by the package and never
   * reach the task handler. Any other string is delivered to
   * registerWidgetTaskHandler as a `WIDGET_CLICK` carrying `clickActionData`.
   */
  interface ClickActionProps {
    clickAction?:     'OPEN_APP' | 'OPEN_URI' | string;
    clickActionData?: Record<string, unknown>;
  }

  interface TextWidgetStyle {
    fontSize?:   number;
    fontWeight?: '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
    color?:      string;
    textAlign?:  'left' | 'center' | 'right';
    flex?:       number;
    marginLeft?:   number;
    marginRight?:  number;
    marginTop?:    number;
    marginBottom?: number;
  }

  interface IconWidgetStyle {
    color?:        string;
    marginLeft?:   number;
    marginRight?:  number;
    marginTop?:    number;
    marginBottom?: number;
  }

  export const FlexWidget: (
    props: ClickActionProps & { style?: FlexWidgetStyle; children?: ReactNode },
  ) => ReactElement;
  export const TextWidget: (
    props: ClickActionProps & { text: string; maxLines?: number; style?: TextWidgetStyle },
  ) => ReactElement;
  export const IconWidget: (
    props: ClickActionProps & {
      font?:  'material' | 'material_community';
      icon:   string;
      size:   number;
      style?: IconWidgetStyle;
    },
  ) => ReactElement;

  // ─── Headless task ────────────────────────────────────────────────────────

  export type WidgetAction =
    | 'WIDGET_ADDED'
    | 'WIDGET_UPDATE'
    | 'WIDGET_RESIZED'
    | 'WIDGET_DELETED'
    | 'WIDGET_CLICK';

  export interface WidgetInfo {
    widgetName: string;
    width:      number;
    height:     number;
  }

  export interface WidgetTaskHandlerProps {
    widgetInfo:   WidgetInfo;
    widgetAction: WidgetAction;
    renderWidget: (component: ReactElement) => void;
    /** Set only when widgetAction is 'WIDGET_CLICK'. */
    clickAction?:     string;
    /** Payload attached to the tapped element's clickActionData. */
    clickActionData?: Record<string, unknown>;
  }

  export function registerWidgetTaskHandler(
    handler: (props: WidgetTaskHandlerProps) => void | Promise<void>,
  ): void;

  export function requestWidgetUpdate(opts: { widgetName: string }): Promise<void>;
}
