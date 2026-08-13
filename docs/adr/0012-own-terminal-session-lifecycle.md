# ADR 0012: Own terminal session lifecycle behind one runtime interface

- Status: Accepted
- Date: 2026-08-13

## Context

`sessionActions` created and closed SSH/Telnet managers and imported suspend-handler registration, while `sshSuspendActions` imported session open, activate, and close operations to resume a suspended SSH session. The two runtime modules formed the final frontend import cycle. Session creation order, resume-mode connection behavior, WebSocket handler lifetime, cached-output routing, suspend projection updates, and failure cleanup were split across both implementations. The suspend handler registration also fetched the suspended-session list for every new SSH connection even though the suspended-session view already owns initial and visibility refreshes.

## Decision

The Terminal session lifecycle exposes `connect`, `open`, `resume`, `activate`, and `close`. Its implementation owns SSH/Telnet manager construction, handler registration before WebSocket connect, backend session-ID rekeying, reconnect behavior, suspended-session resume messages, cached-output routing, suspend projection updates, and deterministic resource cleanup. Resume failures retain the suspended projection and close the pre-created frontend session. Telnet uses the same shell lifecycle without registering SSH suspend handlers.

`session.store` is the composition root: it creates one lifecycle with the connection catalog and translation adapter, delegates terminal actions to it, and delegates RDP/VNC creation and closure to the remote-desktop actions. `sshSuspendActions` retains user commands and HTTP projection operations only. Suspended-session list refresh remains single-flight and view-owned instead of running once per SSH connection. The emitted-JavaScript import graph guard rejects every frontend runtime cycle.

## Consequences

Deleting the lifecycle would force manager creation, handler ordering, resume rollback, and cleanup rules back into the store and suspend actions, so the interface hides real implementation complexity rather than forwarding callbacks. Terminal behavior is covered through the lifecycle interface with real production managers and a fake WebSocket for normal SSH, resume success, backend resume failure, Telnet isolation, and close cleanup. RDP/VNC behavior remains outside this module, and opening a suspended-session view may still issue its existing HTTP refresh.
