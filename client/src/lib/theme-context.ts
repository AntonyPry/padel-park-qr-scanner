import { createContext, useContext } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'crm-theme';

export type ThemeContextValue = {
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemeMode) => void;
  theme: ThemeMode;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider.');
  }

  return context;
}

