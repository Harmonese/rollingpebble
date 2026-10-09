# Repository working notes

Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup and checks, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for boundaries. User instructions take priority.

- Preserve the existing React UI style and localization conventions.
- Audio import is transient. Only Save Project and starting Auto Timing create persistent workspace projects.
- Reuse the application confirmation dialog. Do not introduce browser-native confirm/alert/prompt into business flows.
- Use isolated app data for tests and native smoke checks; do not delete user projects or caches.
- Keep current behavior in docs, historical facts in CHANGELOG, and upstream copyright notices intact.
- Run checks appropriate to the change as described in the development guide. Do not publish or release merely to test CI.
