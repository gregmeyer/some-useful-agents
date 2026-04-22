/**
 * Output widget schema. Agents declare an `outputWidget` that tells the
 * dashboard how to render their run output as a structured widget instead
 * of raw text. This decouples agent output presentation from dashboard code.
 */

/** Field type determines rendering: text is plain, code gets monospace+scroll,
 *  badge gets a colored pill, action renders a button, metric renders a big number,
 *  stat renders a compact label+value pair in a grid. */
export type WidgetFieldType = 'text' | 'code' | 'badge' | 'action' | 'metric' | 'stat';

export interface WidgetField {
  /** Key in the structured output to extract this field from. */
  name: string;
  /** Display label. Defaults to `name` if omitted. */
  label?: string;
  /** How to render the field value. */
  type: WidgetFieldType;
}

export interface WidgetAction {
  /** Unique action identifier. */
  id: string;
  /** Button label. */
  label: string;
  /** HTTP method (only POST supported initially). */
  method: 'POST';
  /** Endpoint path. `{agentId}` is replaced with the agent's id at render time. */
  endpoint: string;
  /** Which field's value to send as the request body payload. */
  payloadField?: string;
}

export type OutputWidgetType = 'diff-apply' | 'key-value' | 'raw' | 'dashboard';

export interface OutputWidgetSchema {
  /** Widget type determines the layout and rendering strategy. */
  type: OutputWidgetType;
  /** Fields to extract from the run output and display. */
  fields: WidgetField[];
  /** Interactive actions (buttons) the user can trigger from the widget. */
  actions?: WidgetAction[];
}
