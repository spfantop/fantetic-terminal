# Fantetic Terminal Domain Context

## Product runtimes

- **Web runtime**: a session-authenticated, multi-user bastion runtime.
- **Desktop runtime**: a loopback-only local runtime using a synthetic local account and no Web login.
- **Docker release set**: the four image digests built from one source revision and published under one immutable version.
- **Locale runtime**: the frontend projection that loads one selected language, keeps the default fallback available, and commits language changes across vue-i18n, the document, local preference, and persisted settings.
- **Authentication runtime**: the frontend coordinator that invalidates a Web session projection, clears user-scoped cache data, and completes login navigation without coupling the HTTP client or auth store to the router.

## Access-control language

- **User**: a human Web-runtime identity.
- **System role**: instance-wide authority: `super_admin`, `admin`, `user`, or `auditor`.
- **User group**: a named set of users used to delegate access to managed connections.
- **Group role**: authority inside one group: `owner`, `admin`, `operator`, or `viewer`.
- **Managed connection**: an SSH, TELNET, RDP, or VNC target owned by one user and optionally delegated to multiple groups.
- **Managed connection catalog**: the user-scoped frontend projection of readable managed connections and their folders.
- **Connection permission**: delegated authority over one managed connection: `view`, `connect`, or `manage`.
- **Resource owner**: the user responsible for a private resource such as a managed connection, proxy, SSH key, folder, or tag.

## Invariants

1. Web access is denied unless the user owns the resource, has an adequate group grant, or has an adequate system role.
2. A user may belong to multiple user groups with a different group role in each.
3. A managed connection may be delegated to multiple user groups with a different permission in each.
4. Group membership alone does not grant connection access; an explicit connection grant is required.
5. Desktop local-account behaviour never weakens Web-runtime authorization.
6. Existing single-user data is assigned to the oldest user during the multi-user migration.
7. User-supplied terminal background HTML executes only inside an opaque-origin sandbox with no network access.
8. The desktop renderer receives its runtime nonce only after the packaged backend proves nonce possession and the spawned child is still alive.
9. WebSocket session cleanup completes before database shutdown begins.
10. Core WebSocket messages cross runtime boundaries through shared contracts and runtime validation before reaching stateful handlers.
11. Workspace test sources pass strict type checks, and each discovered behavior group runs at most once under bounded concurrency.
12. Managed connection catalog reads are validated and single-flight per user scope; stale scope or pre-mutation responses never replace the current projection.
13. A distributed Docker deployment selects one completed Docker release set; frontend, backend, and Remote Gateway never resolve independent moving tags.
14. Live SSH resources have exactly one owner: the WebSocket session or the suspended-session runtime; failed transfer closes the detached channel and client before session cleanup completes.
15. The locale runtime installs the default fallback before mounting, loads non-default languages on demand, and serializes persisted language changes so the active locale, document language, and settings projection cannot diverge.
16. The authentication runtime is installed before the first protected HTTP request; concurrent invalidations share one completion, Desktop invalidation is a no-op, and authentication modules remain outside runtime import cycles.
