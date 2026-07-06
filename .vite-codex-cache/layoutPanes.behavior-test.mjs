// test/layoutPanes.behavior-test.ts
import assert from "node:assert/strict";

// src/utils/layoutPanes.ts
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
var actionPaneSet = new Set(ACTION_LAYOUT_PANES);
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

// test/layoutPanes.behavior-test.ts
assert.ok(
  CONFIGURABLE_LAYOUT_PANES.includes("terminalLineOutputToggle"),
  "terminal single/multi-line output toggle must be configurable in layout manager"
);
assert.ok(
  ACTION_LAYOUT_PANES.includes("terminalLineOutputToggle"),
  "terminal single/multi-line output toggle should behave as a toolbar action pane"
);
assert.equal(
  CONFIGURABLE_LAYOUT_PANES.includes("suspendedSshSessions"),
  false,
  "suspended session manager must not be configurable from layout manager"
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
console.log("layoutPanes behavior ok");
