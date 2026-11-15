// The @actions packages are ESM-only: their package exports name only the
// "import" condition, which Jest's CommonJS runtime does not ask for. Resolve
// them, and only them, with "import"; package.json transforms their files to
// CommonJS for the tests. The bundle (ncc) resolves them on its own.
module.exports = (request, options) =>
  options.defaultResolver(
    request,
    request.startsWith('@actions/')
      ? { ...options, conditions: ['import', 'node', 'default'] }
      : options
  )
