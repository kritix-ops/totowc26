// Empty stub the vitest config aliases `server-only` to so modules
// that begin with `import "server-only";` can be loaded in a Node
// test runner. The real `server-only` package only exists to throw
// at build time inside a client bundle.
export {};
