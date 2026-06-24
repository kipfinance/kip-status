const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../assets/kip-status.js"), "utf8");
const sandbox = {
  console,
  document: { getElementById: () => null },
  Intl,
  URL,
  window: {
    __KIP_STATUS_TEST__: true,
    location: { hostname: "localhost", href: "https://status.kip-ai.com/" },
  },
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const {
  barState,
  buildBars,
  isUpptimeIssueRequest,
  resultForRow,
  stateForComponent,
} = sandbox.window.__kipStatusTestUtils;

const now = new Date("2026-06-24T00:00:00.000Z");

assert.equal(stateForComponent(null, now), "down");
assert.equal(stateForComponent({ status: "down" }, now), "down");
assert.equal(stateForComponent({ status: "ok", expires_at: "2026-06-24T00:00:00.000Z" }, now), "warn");
assert.equal(stateForComponent({ status: "ok", expires_at: "2026-06-24T00:00:01.000Z" }, now), "ok");

assert.equal(barState(0, true), "none");
assert.equal(barState(0, false), "good");
assert.equal(barState(1, false), "partial");
assert.equal(barState(59, false), "partial");
assert.equal(barState(60, false), "degraded");
assert.equal(barState(1439, false), "degraded");
assert.equal(barState(1440, false), "down");

const bars = buildBars(
  {
    startTime: "2026-06-23T02:40:00.000Z",
    summary: {
      dailyMinutesDown: {
        "2026-06-23": 60,
        "2026-06-24": 1440,
      },
    },
  },
  3,
  new Date("2026-06-24T12:00:00.000Z"),
);

assert.equal(
  JSON.stringify(bars.map((bar) => [bar.dateKey, bar.state, bar.today])),
  JSON.stringify([
    ["2026-06-22", "none", false],
    ["2026-06-23", "degraded", false],
    ["2026-06-24", "down", true],
  ]),
);

assert.equal(
  resultForRow({
    id: "tax_engine_artifacts",
    state: "ok",
    snapshot: {
      summary: "internal runner summary should not render",
    },
  }),
  "Tax artifact check passed.",
);
assert.equal(resultForRow({ id: "login_authentication", state: "down" }), "Check failed.");

assert.equal(
  isUpptimeIssueRequest("https://api.github.com/repos/kipfinance/kip-status/issues?state=open"),
  true,
);
assert.equal(
  isUpptimeIssueRequest({ url: "https://api.github.com/repos/kipfinance/kip-status/issues?state=closed" }),
  true,
);
assert.equal(
  isUpptimeIssueRequest("https://api.github.com/repos/kipfinance/kip-status/actions/runs"),
  false,
);
assert.equal(
  isUpptimeIssueRequest("https://raw.githubusercontent.com/kipfinance/kip-status/main/history/summary.json"),
  false,
);

console.log("kip-status tests passed");
