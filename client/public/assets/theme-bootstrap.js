(() => {
  try {
    const theme = localStorage.getItem('crm-theme') || 'system';
    const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  } catch {
    document.documentElement.style.colorScheme = 'light';
  }
})();
