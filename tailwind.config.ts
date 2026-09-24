import type { Config } from 'tailwindcss';

/**
 * Tailwind CSS v4 uses a CSS-first configuration (see src/app/globals.css).
 * This TypeScript config is loaded via the `@config` directive in globals.css
 * and carries settings that are cleaner to express here — notably class-based
 * dark mode, which the field-worker surface and the theme toggle rely on.
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
};

export default config;
