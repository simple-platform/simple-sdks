import antfu from '@antfu/eslint-config'
import globals from 'globals'

export default antfu({
  formatters: {
    markdown: 'prettier',
  },

  ignores: [
    'node_modules/',
    'dist/',

    // Cargo's build directory. It is JSON all the way down — `.rustc_info.json`,
    // every `.fingerprint/*.json`, and any fixture a test writes — and eslint
    // lints JSON, so cargo's cache is kept out of `pnpm lint` and out of
    // `lint-staged`. Listed here as well as in .gitignore, so eslint's view does
    // not depend on git's.
    '**/target/',
  ],

  languageOptions: {
    globals: {
      ...globals.node,
    },
  },

  rules: {
    'import/order': ['off'],
    'perfectionist/sort-objects': 'error',
  },

  stylistic: true,
  typescript: true,
})
