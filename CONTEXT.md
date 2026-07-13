# Fantetic Terminal Domain Context

## Product runtimes

- **Web runtime**: a session-authenticated, multi-user bastion runtime.
- **Desktop runtime**: a loopback-only local runtime using a synthetic local account and no Web login.

## Access-control language

- **User**: a human Web-runtime identity.
- **System role**: instance-wide authority: `super_admin`, `admin`, `user`, or `auditor`.
- **User group**: a named set of users used to delegate access to managed connections.
- **Group role**: authority inside one group: `owner`, `admin`, `operator`, or `viewer`.
- **Managed connection**: an SSH, TELNET, RDP, or VNC target owned by one user and optionally delegated to multiple groups.
- **Connection permission**: delegated authority over one managed connection: `view`, `connect`, or `manage`.
- **Resource owner**: the user responsible for a private resource such as a managed connection, proxy, SSH key, folder, or tag.

## Invariants

1. Web access is denied unless the user owns the resource, has an adequate group grant, or has an adequate system role.
2. A user may belong to multiple user groups with a different group role in each.
3. A managed connection may be delegated to multiple user groups with a different permission in each.
4. Group membership alone does not grant connection access; an explicit connection grant is required.
5. Desktop local-account behaviour never weakens Web-runtime authorization.
6. Existing single-user data is assigned to the oldest user during the multi-user migration.
