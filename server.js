const express = require("express");
const path = require("path");
const {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} = require("prom-client");

const app = express();
const port = Number(process.env.PORT || 3000);
const register = new Registry();

collectDefaultMetrics({ register, prefix: "traffic_lab_" });

const httpRequests = new Counter({
  name: "traffic_lab_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["route", "method", "status_code"],
  registers: [register],
});

const scenarioRuns = new Counter({
  name: "traffic_lab_scenario_runs_total",
  help: "Number of scenario activations",
  labelNames: ["scenario"],
  registers: [register],
});

const appLogs = new Counter({
  name: "traffic_lab_logs_total",
  help: "Log lines written by level",
  labelNames: ["level", "scenario"],
  registers: [register],
});

const requestDuration = new Histogram({
  name: "traffic_lab_request_duration_ms",
  help: "Request duration in milliseconds",
  labelNames: ["route", "method", "status_code"],
  buckets: [5, 20, 50, 100, 200, 400, 800, 1200, 2000],
  registers: [register],
});

const activeWorkersGauge = new Gauge({
  name: "traffic_lab_active_workers",
  help: "Number of active background workers",
  registers: [register],
});

const scenarioGauge = new Gauge({
  name: "traffic_lab_active_scenario",
  help: "Current scenario intensity represented as an ordinal value",
  labelNames: ["scenario"],
  registers: [register],
});

const syntheticUsersGauge = new Gauge({
  name: "traffic_lab_synthetic_users",
  help: "Simulated concurrent synthetic users",
  registers: [register],
});

const memoryBlocksGauge = new Gauge({
  name: "traffic_lab_memory_blocks",
  help: "Count of in-memory blocks allocated to simulate memory pressure",
  registers: [register],
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const state = {
  scenario: "idle",
  requestsTotal: 0,
  errorsTotal: 0,
  logsTotal: 0,
  warningsTotal: 0,
  lastLatencyMs: 0,
  latencySamples: [],
  recentEvents: [],
  activeWorkers: 0,
  syntheticUsers: 0,
  noiseLevel: 0,
  memoryBlocks: [],
  backgroundJobsStarted: 0,
  startedAt: Date.now(),
  scenarioUntil: 0,
  intervalHandles: [],
};

function nowIso() {
  return new Date().toISOString();
}

function averageLatency() {
  if (state.latencySamples.length === 0) {
    return 0;
  }
  const total = state.latencySamples.reduce((sum, value) => sum + value, 0);
  return Math.round((total / state.latencySamples.length) * 10) / 10;
}

function pushEvent(type, message, extra = {}) {
  const event = {
    at: nowIso(),
    type,
    message,
    ...extra,
  };
  state.recentEvents.unshift(event);
  state.recentEvents = state.recentEvents.slice(0, 20);
}

function writeLog(level, message, extra = {}) {
  const payload = {
    ts: nowIso(),
    level,
    service: "traffic-lab",
    scenario: state.scenario,
    message,
    ...extra,
  };
  console.log(JSON.stringify(payload));
  state.logsTotal += 1;
  if (level === "warn") {
    state.warningsTotal += 1;
  }
  appLogs.inc({ level, scenario: state.scenario });
}

function updateGauges() {
  activeWorkersGauge.set(state.activeWorkers);
  syntheticUsersGauge.set(state.syntheticUsers);
  memoryBlocksGauge.set(state.memoryBlocks.length);
  for (const scenarioName of ["idle", "steady", "spiky", "noisy", "chaos"]) {
    scenarioGauge.set({ scenario: scenarioName }, state.scenario === scenarioName ? 1 : 0);
  }
}

function recordSyntheticRequest({ route, method, statusCode, latencyMs, error = false }) {
  state.requestsTotal += 1;
  state.lastLatencyMs = latencyMs;
  state.latencySamples.push(latencyMs);
  state.latencySamples = state.latencySamples.slice(-200);
  if (error) {
    state.errorsTotal += 1;
  }

  httpRequests.inc({ route, method, status_code: String(statusCode) });
  requestDuration.observe({ route, method, status_code: String(statusCode) }, latencyMs);
}

function busyLoop(ms) {
  const end = Date.now() + ms;
  let sink = 0;
  while (Date.now() < end) {
    sink += Math.sqrt(Math.random() * 10_000);
  }
  return sink;
}

function clearScenarioIntervals() {
  for (const handle of state.intervalHandles) {
    clearInterval(handle);
  }
  state.intervalHandles = [];
}

function allocateMemory(blocks) {
  state.memoryBlocks = Array.from({ length: blocks }, (_, index) => ({
    id: index,
    payload: "x".repeat(256 * 1024),
  }));
}

function activateScenario(name) {
  clearScenarioIntervals();

  const config = {
    idle: { users: 1, workers: 1, noiseLevel: 1, memoryBlocks: 2, durationMs: 0 },
    steady: { users: 12, workers: 2, noiseLevel: 2, memoryBlocks: 8, durationMs: 0 },
    spiky: { users: 42, workers: 4, noiseLevel: 3, memoryBlocks: 20, durationMs: 0 },
    noisy: { users: 20, workers: 3, noiseLevel: 5, memoryBlocks: 12, durationMs: 0 },
    chaos: { users: 28, workers: 5, noiseLevel: 4, memoryBlocks: 16, durationMs: 0 },
  }[name];

  if (!config) {
    return false;
  }

  state.scenario = name;
  state.syntheticUsers = config.users;
  state.activeWorkers = config.workers;
  state.noiseLevel = config.noiseLevel;
  allocateMemory(config.memoryBlocks);
  state.scenarioUntil = config.durationMs ? Date.now() + config.durationMs : 0;
  state.backgroundJobsStarted += config.workers;
  scenarioRuns.inc({ scenario: name });
  updateGauges();

  pushEvent("scenario", `Scenario switched to ${name}`, {
    syntheticUsers: config.users,
    workers: config.workers,
  });
  writeLog("info", "scenario changed", {
    scenario_target: name,
    synthetic_users: config.users,
    workers: config.workers,
  });

  const trafficHandle = setInterval(() => {
    const burst = name === "spiky" ? 5 : name === "chaos" ? 4 : 2;
    for (let i = 0; i < burst; i += 1) {
      const latencyMs =
        name === "spiky"
          ? 100 + Math.round(Math.random() * 900)
          : name === "chaos"
            ? 120 + Math.round(Math.random() * 1200)
            : 20 + Math.round(Math.random() * 180);
      const isError =
        name === "chaos"
          ? Math.random() < 0.22
          : name === "spiky"
            ? Math.random() < 0.1
            : Math.random() < 0.03;

      recordSyntheticRequest({
        route: "/api/simulate",
        method: "GET",
        statusCode: isError ? 500 : 200,
        latencyMs,
        error: isError,
      });

      if (isError) {
        writeLog("error", "synthetic request failed", {
          route: "/api/simulate",
          status_code: 500,
          duration_ms: latencyMs,
          synthetic_user_id: Math.ceil(Math.random() * state.syntheticUsers),
        });
      } else if (Math.random() < 0.45) {
        writeLog("info", "synthetic request processed", {
          route: "/api/simulate",
          status_code: 200,
          duration_ms: latencyMs,
          synthetic_user_id: Math.ceil(Math.random() * state.syntheticUsers),
        });
      }
    }
  }, 1200);

  const workerHandle = setInterval(() => {
    const cpuMs = name === "steady" ? 15 : name === "noisy" ? 25 : 40;
    busyLoop(cpuMs);
    if (Math.random() < 0.35) {
      writeLog("warn", "background worker retried task", {
        worker_pool: name,
        retry_in_ms: 250 + Math.round(Math.random() * 1000),
      });
    }
  }, 1500);

  state.intervalHandles.push(trafficHandle, workerHandle);

  if (name === "noisy") {
    const noisyHandle = setInterval(() => {
      for (let i = 0; i < 5; i += 1) {
        writeLog("info", "audit trail event", {
          category: "audit",
          actor: `demo-user-${1 + Math.floor(Math.random() * 6)}`,
          action: ["login", "view_dashboard", "refresh_widget"][Math.floor(Math.random() * 3)],
        });
      }
    }, 1800);
    state.intervalHandles.push(noisyHandle);
  }

  if (name === "chaos") {
    const chaosHandle = setInterval(() => {
      pushEvent("incident", "Downstream timeout burst detected", {
        affectedRoute: "/api/reports",
      });
      writeLog("error", "downstream timeout burst", {
        route: "/api/reports",
        upstream: "reporting-engine",
        failures: 1 + Math.floor(Math.random() * 4),
      });
    }, 4000);
    state.intervalHandles.push(chaosHandle);
  }

  return true;
}

activateScenario("steady");

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    recordSyntheticRequest({
      route: req.route?.path || req.path,
      method: req.method,
      statusCode: res.statusCode,
      latencyMs: Math.round(elapsedMs),
      error: res.statusCode >= 500,
    });
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    scenario: state.scenario,
    uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
  });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.get("/api/stats", (_req, res) => {
  const memoryUsage = process.memoryUsage();
  res.json({
    scenario: state.scenario,
    requestsTotal: state.requestsTotal,
    errorsTotal: state.errorsTotal,
    logsTotal: state.logsTotal,
    warningsTotal: state.warningsTotal,
    lastLatencyMs: state.lastLatencyMs,
    avgLatencyMs: averageLatency(),
    activeWorkers: state.activeWorkers,
    syntheticUsers: state.syntheticUsers,
    backgroundJobsStarted: state.backgroundJobsStarted,
    memoryRssMb: Math.round((memoryUsage.rss / 1024 / 1024) * 10) / 10,
    heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 10) / 10,
    events: state.recentEvents,
    startedAt: state.startedAt,
  });
});

app.post("/api/scenario/:name", (req, res) => {
  const ok = activateScenario(req.params.name);
  if (!ok) {
    writeLog("warn", "unknown scenario requested", { requested: req.params.name });
    return res.status(404).json({ error: "unknown scenario" });
  }
  return res.json({ ok: true, scenario: state.scenario });
});

app.post("/api/noise", (req, res) => {
  const amount = Math.max(1, Math.min(Number(req.body.amount) || 25, 200));
  for (let i = 0; i < amount; i += 1) {
    const levels = ["info", "warn", "error"];
    const level = levels[Math.floor(Math.random() * levels.length)];
    writeLog(level, "manual noise injection", {
      batch_size: amount,
      line: i + 1,
      route: "/api/noise",
    });
  }
  pushEvent("noise", `Injected ${amount} log lines`, { amount });
  res.json({ ok: true, amount });
});

app.get("/api/reports", async (_req, res) => {
  const latencyMs = 250 + Math.round(Math.random() * 900);
  await new Promise((resolve) => setTimeout(resolve, latencyMs));
  if (state.scenario === "chaos" && Math.random() < 0.35) {
    writeLog("error", "report generation failed", {
      route: "/api/reports",
      duration_ms: latencyMs,
      report_id: `rep-${Math.floor(Math.random() * 9999)}`,
    });
    return res.status(500).json({ error: "reporting timeout" });
  }
  writeLog("info", "report generated", {
    route: "/api/reports",
    duration_ms: latencyMs,
    report_id: `rep-${Math.floor(Math.random() * 9999)}`,
  });
  return res.json({
    ok: true,
    generatedAt: nowIso(),
    durationMs: latencyMs,
  });
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  updateGauges();
  writeLog("info", "traffic-lab started", { port });
  pushEvent("boot", "Service started and ready", { port });
});
