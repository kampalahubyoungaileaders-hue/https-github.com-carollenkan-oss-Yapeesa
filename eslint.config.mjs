import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import noFloatingMoney from './tooling/no-floating-money.mjs';
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/.turbo/**',
      'supabase/.temp/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
  {
    files: ['packages/domain/src/**/*.ts', '**/*money*.ts'],
    plugins: { yapesa: { rules: { 'no-floating-money': noFloatingMoney } } },
    rules: { 'yapesa/no-floating-money': 'error' },
  },
);
