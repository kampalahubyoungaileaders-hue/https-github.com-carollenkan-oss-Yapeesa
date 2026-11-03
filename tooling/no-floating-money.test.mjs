import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-floating-money.mjs';
const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});
tester.run('no-floating-money', rule, {
  valid: [
    'const amount: bigint = 100n;',
    'const instalment = principal / count;',
    'export const calcVersion = "phase-0";',
  ],
  invalid: [
    { code: 'const amount = 1.5;', errors: [{ messageId: 'forbidden' }] },
    {
      code: 'const amount: number = input;',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      code: 'const amount = Number(input);',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      code: 'const amount = parseFloat(input);',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      code: 'const amount = Math.round(input);',
      errors: [{ messageId: 'forbidden' }],
    },
    { code: 'const amount = +input;', errors: [{ messageId: 'forbidden' }] },
    {
      code: 'const amount = 9007199254740992;',
      errors: [{ messageId: 'forbidden' }],
    },
  ],
});
