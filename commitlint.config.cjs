// THE TYPES AND SCOPES A COMMIT IN THIS REPOSITORY MAY CARRY.
//
// Two things read this file: the `commit-msg` hook, which refuses a message
// before the commit exists, and the "Commit convention" check, which refuses a
// pull request's title. The title is checked because this repository squash
// merges: the title is the subject that lands on `main`, and the subject is
// what the release lanes in .github/workflows/release.yml read to choose a
// version and to write a changelog. A scope they do not know is a change that
// is released as a patch and announced nowhere.

const TYPES = ['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'style', 'revert']

const SCOPES = [
  // One per package. Each release lane reads its own.
  'sdk-ts', // sdks/ts, the TypeScript SDK
  'sdk-space', // sdks/ts/src/space, the Space SDK inside the TypeScript SDK's package
  'sdk-rust', // sdks/rust
  'sdk-ui', // sdks/space-ui, the UI Kit
  'sdk-go',
  'sdk-py',
  // Everything that is not one package: workflows, tooling, the root documents.
  'repo',
  // What Renovate and Dependabot write.
  'deps',
  'deps-dev',
]

module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        // A lane matches `type(scope):` with one scope in it, so a commit under
        // two would be counted by neither.
        'one-scope': ({ scope }) => [!scope || !/[,/\\]/.test(scope), 'a commit carries exactly one scope'],
      },
    },
  ],
  rules: {
    'one-scope': [2, 'always'],
    'scope-empty': [2, 'never'],
    'scope-enum': [2, 'always', SCOPES],
    'type-enum': [2, 'always', TYPES],
  },
}
