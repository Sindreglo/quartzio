import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ENGINE = 'packages/gantt/src';
const TS_FILES = ['**/*.{ts,tsx}'];
const TESTS = ['**/*.test.{ts,tsx}'];

// Engine layers, lowest first. A layer may only import from itself or layers below it, so lower layers (data,
// calendar, scheduling) never learn about pixels, viewports or interaction.
const LAYERS = ['util', 'data', 'calendar', 'scheduling', 'timeaxis', 'view', 'features'];

const TIME_ZONE_MESSAGE =
  'This depends on the host time zone. Use the time-zone aware helpers in util/ instead.';
const TIME_ZONE_SENSITIVE = [
  // Wall-clock getters/setters and formatting.
  'CallExpression > MemberExpression.callee > Identifier.property[name=/^((get|set)(UTC)?(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)|getTimezoneOffset|toLocale(Date|Time)?String|toDateString|toTimeString)$/]',
  // new Date(2026, 0, 5) is local wall time; new Date('2026-01-05T08:00') is parsed as local time.
  "NewExpression[callee.name='Date'][arguments.length>1]",
  "NewExpression[callee.name='Date'][arguments.0.type='Literal'][arguments.0.raw=/^['\"]/]",
  "NewExpression[callee.name='Date'][arguments.0.type='TemplateLiteral']",
  "CallExpression[callee.object.name='Date'][callee.property.name='parse']",
].map((selector) => ({ selector, message: TIME_ZONE_MESSAGE }));

const NO_RUNTIME_DEPS = {
  regex: '^[^.]',
  message: 'The engine has no runtime dependencies: dates, scheduling and layout are written in-house.',
};
const NO_RUNTIME_DEPS_IN_TESTS = { ...NO_RUNTIME_DEPS, regex: '^(?!\\.|vitest$)' };

// `..` and `../index` from inside a layer resolve to the package root, which re-exports every layer.
const NO_ROOT_IMPORT = {
  regex: '^\\.\\.(/index(\\.[jt]s)?)?$',
  message:
    'Layer files must not import the package root (it re-exports every layer). Import the module directly.',
};

const layerRules = (layer, index, isTest) => {
  const higher = LAYERS.slice(index + 1);
  const patterns = [isTest ? NO_RUNTIME_DEPS_IN_TESTS : NO_RUNTIME_DEPS, NO_ROOT_IMPORT];
  if (higher.length > 0) {
    patterns.push({
      regex: `(^|/)(${higher.join('|')})(/|$)`,
      message: `Layer "${layer}" must not import from higher layers (${higher.join(', ')}).`,
    });
  }
  return {
    name: `quartzio/layer-${layer}${isTest ? '-tests' : ''}`,
    files: isTest ? [`${ENGINE}/${layer}/**/*.test.{ts,tsx}`] : [`${ENGINE}/${layer}/**/*.{ts,tsx}`],
    ...(isTest ? {} : { ignores: TESTS }),
    rules: { 'no-restricted-imports': ['error', { patterns }] },
  };
};

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', '**/.turbo/']),

  js.configs.recommended,

  {
    name: 'quartzio/node-scripts',
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },

  // Type-aware linting for all source code.
  {
    name: 'quartzio/typescript',
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      // Conflicts with no-non-null-assertion (from strict): we prefer explicit `as T` over `!`.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Config files outside any tsconfig: syntax-level TypeScript rules only.
  {
    name: 'quartzio/typescript-config-files',
    files: TS_FILES,
    ignores: ['packages/*/src/**', 'apps/*/src/**'],
    extends: [tseslint.configs.recommended],
  },

  {
    name: 'quartzio/react',
    files: ['packages/gantt-react/src/**/*.tsx', 'apps/*/src/**/*.tsx'],
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
  },

  // --- Engine architecture rules (see CLAUDE.md) ---

  // Files directly in src/ (the public surface) may import from any layer, but not from npm.
  {
    name: 'quartzio/engine-root',
    files: [`${ENGINE}/*.{ts,tsx}`],
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_RUNTIME_DEPS] }] },
  },
  ...LAYERS.flatMap((layer, index) => [layerRules(layer, index, false), layerRules(layer, index, true)]),

  // Wall-clock Date methods depend on the host time zone; only util/ may use them.
  {
    name: 'quartzio/engine-time-zone-safety',
    files: [`${ENGINE}/**/*.{ts,tsx}`],
    ignores: [`${ENGINE}/util/**`],
    rules: {
      'no-restricted-syntax': ['error', ...TIME_ZONE_SENSITIVE],
    },
  },

  prettier,
);
