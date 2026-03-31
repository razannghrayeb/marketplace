## Architecture & Module Guidelines

This document describes the recommended file layout and conventions for adding or modifying HTTP API modules.

Project layout (excerpt):

```
src/
  routes/
    <module>/
      <module>.routes.ts       # Route definitions only
      <module>.controller.ts   # HTTP handlers (validation, req/res)
      <module>.service.ts      # Business logic (DB, search, queueing)
      index.ts                 # Exports for the module
  lib/
    ...                       # Shared helpers / cross-cutting libraries
```

Conventions
- Routes: Keep `*.routes.ts` minimal — only define paths and apply middleware (auth, uploads). Handlers should be imported from the controller file.
- Controllers: Implement request parsing, basic validation, response formatting and error handling. Controllers should call services to perform business work and return standard JSON responses.
- Services: Contain all database calls, OpenSearch queries, queue interactions and other I/O. Services should not access `req`/`res` objects and should be unit-testable.

Import paths and re-exports
- Other parts of the app should import route modules from `src/routes/<module>/index.ts` which exports the router (and optionally service wrappers).
- Some `src/lib/*` entrypoints may re-export functions from `src/routes/*` for backward compatibility. When moving logic prefer extracting into `src/lib/*` if it becomes widely reused.

Adding a new API module
1. Create `src/routes/<module>/` directory.
2. Add `<module>.service.ts` with business logic first (so controller can import it safely).
3. Add `<module>.controller.ts` with handler functions that call the service functions.
4. Add `<module>.routes.ts` that maps HTTP paths to controller handlers and apply middleware (e.g., multer). Export the router as `export { router as <module>Router }`.
5. Add `index.ts` that exports the router and any needed service functions for the rest of the app.

Testing and linting
- Keep services small and unit-testable. Mock database and search clients in tests.
- Run `pnpm build` and `pnpm lint` (if available) after adding new files.

Notes
- If a service becomes shared across multiple modules, consider extracting it into `src/lib/` and updating imports.
- Maintain consistent error handling via the middleware in `src/middleware/errorHandler.ts`.
- Search and embeddings: **`docs/embeddings-and-search-pipelines.md`** (vectors); **`docs/FEATURES.md`** (which feature calls which route).

This guideline helps keep the codebase modular, testable, and easy to navigate for new contributors.


