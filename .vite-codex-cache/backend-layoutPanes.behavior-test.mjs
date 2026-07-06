// src/test/layoutPanes.behavior-test.ts
import assert from "node:assert/strict";

// src/settings/layoutPanes.ts
var CONFIGURABLE_LAYOUT_PANES = [
  "connections",
  "terminal",
  "commandBar",
  "fileManager",
  "editor",
  "statusMonitor",
  "commandHistory",
  "quickCommands",
  "dockerManager",
  "terminalLineOutputToggle",
  "transferProgress"
];
var ACTION_LAYOUT_PANES = [
  "terminalLineOutputToggle"
];
var configurablePaneSet = new Set(CONFIGURABLE_LAYOUT_PANES);
var isConfigurableLayoutPane = (value) => typeof value === "string" && configurablePaneSet.has(value);
var normalizeConfigurablePaneList = (value) => {
  const panes = [];
  const seen = /* @__PURE__ */ new Set();
  value.forEach((item) => {
    if (!isConfigurableLayoutPane(item) || seen.has(item)) return;
    panes.push(item);
    seen.add(item);
  });
  return panes;
};

// src/test/layoutPanes.behavior-test.ts
assert.ok(
  CONFIGURABLE_LAYOUT_PANES.includes("terminalLineOutputToggle"),
  "terminal single/multi-line output toggle must be accepted by backend sidebar settings"
);
assert.ok(
  ACTION_LAYOUT_PANES.includes("terminalLineOutputToggle"),
  "terminal single/multi-line output toggle should be tracked as an action pane"
);
assert.equal(
  isConfigurableLayoutPane("suspendedSshSessions"),
  false,
  "suspended session manager must not be persisted as a configurable sidebar pane"
);
assert.deepEqual(
  normalizeConfigurablePaneList([
    "fileManager",
    "suspendedSshSessions",
    "terminalLineOutputToggle",
    "fileManager",
    "unknown"
  ]),
  ["fileManager", "terminalLineOutputToggle"]
);
console.log("backend layout panes behavior ok");
