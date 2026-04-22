/**
 * Widget theme definitions. Each theme is a set of CSS custom property
 * overrides applied via data-widget-theme attribute.
 */

export interface WidgetTheme {
  id: string;
  name: string;
  description: string;
  preview: { bg: string; surface: string; accent: string; text: string };
}

export const THEMES: WidgetTheme[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Dark mode with teal accent',
    preview: { bg: '#1a1918', surface: '#242220', accent: '#2dd4bf', text: '#e7e5e4' },
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Clean light mode',
    preview: { bg: '#faf9f7', surface: '#ffffff', accent: '#0f766e', text: '#1c1917' },
  },
  {
    id: 'warm',
    name: 'Warm',
    description: 'Amber accent, stone backgrounds',
    preview: { bg: '#1c1917', surface: '#292524', accent: '#f59e0b', text: '#fafaf9' },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'No borders, no shadows, flat',
    preview: { bg: '#1a1918', surface: '#242220', accent: '#a3a3a3', text: '#e7e5e4' },
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'Purple accent, true black',
    preview: { bg: '#0a0a0a', surface: '#171717', accent: '#a855f7', text: '#fafafa' },
  },
];
