import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  THEME_STORAGE_KEY,
  ThemeContext,
  type ThemeContextValue,
  type ThemeMode,
} from '@/lib/theme-context';

const THEME_TRANSITION_TIMEOUT_MS = 1600;

let themeTransitionTimeout: number | undefined;

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => {
    finished: Promise<void>;
  };
};

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
    return savedTheme;
  }

  return 'system';
}

function resolveTheme(theme: ThemeMode) {
  if (theme !== 'system') return theme;

  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function commitResolvedTheme(resolvedTheme: 'light' | 'dark') {
  const root = window.document.documentElement;

  root.classList.toggle('dark', resolvedTheme === 'dark');
  root.style.colorScheme = resolvedTheme;
}

function shouldReduceMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function applyTheme(theme: ThemeMode, options: { animate?: boolean } = {}) {
  const resolvedTheme = resolveTheme(theme);
  const root = window.document.documentElement;
  const shouldAnimate = options.animate !== false && !shouldReduceMotion();
  const viewTransitionDocument = window.document as ViewTransitionDocument;

  window.clearTimeout(themeTransitionTimeout);
  root.classList.remove('theme-transitioning', 'theme-view-transitioning');

  if (!shouldAnimate) {
    commitResolvedTheme(resolvedTheme);
    return;
  }

  if (viewTransitionDocument.startViewTransition) {
    root.classList.add('theme-view-transitioning');
    const transition = viewTransitionDocument.startViewTransition(() => {
      commitResolvedTheme(resolvedTheme);
    });

    const finish = () => {
      root.classList.remove('theme-view-transitioning');
    };

    void transition.finished.finally(finish);
    themeTransitionTimeout = window.setTimeout(finish, THEME_TRANSITION_TIMEOUT_MS);
    return;
  }

  root.classList.add('theme-transitioning');
  // Make sure the transition rule is committed before color variables change.
  void root.offsetWidth;
  commitResolvedTheme(resolvedTheme);

  themeTransitionTimeout = window.setTimeout(() => {
    root.classList.remove('theme-transitioning');
  }, THEME_TRANSITION_TIMEOUT_MS);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    resolveTheme(getInitialTheme()),
  );
  const initialThemeRef = useRef(theme);

  useEffect(() => {
    applyTheme(initialThemeRef.current, { animate: false });
    window.localStorage.setItem(THEME_STORAGE_KEY, initialThemeRef.current);
  }, []);

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    applyTheme(nextTheme, { animate: true });
    setThemeState(nextTheme);
    setResolvedTheme(resolveTheme(nextTheme));
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }, []);

  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      applyTheme('system', { animate: true });
      setResolvedTheme(resolveTheme('system'));
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      resolvedTheme,
      setTheme,
      theme,
    }),
    [resolvedTheme, setTheme, theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
