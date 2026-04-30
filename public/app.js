const scenarioCopy = {
  steady: {
    description: "Стабильная рабочая смена без сюрпризов.",
    narrative: "Трафик идёт ровно, фоновые воркеры заняты спокойно, графики читаются без шума.",
  },
  spiky: {
    description: "Пульсирующие пики и заметные всплески задержки.",
    narrative: "Нагрузка приходит волнами: latency скачет, пики заметны и на графиках, и в таймлайне.",
  },
  noisy: {
    description: "Сервис начинает многословно писать в поток логов.",
    narrative: "Шум логов усиливается, audit-события плодятся быстрее обычного и хорошо видны в Loki.",
  },
  chaos: {
    description: "Ошибки, таймауты и инциденты выходят на передний план.",
    narrative: "Появляется аварийный рисунок: краснеют error-rate, растут таймауты и всплывают incident-события.",
  },
  idle: {
    description: "Почти тишина, только минимальный heartbeat системы.",
    narrative: "Стенд уходит в экономный режим: трафик почти исчезает, остаются только базовые сигналы жизни.",
  },
};

const el = {
  scenarioBadge: document.getElementById("scenarioBadge"),
  scenarioDescription: document.getElementById("scenarioDescription"),
  requestsTotal: document.getElementById("requestsTotal"),
  requestsCaption: document.getElementById("requestsCaption"),
  avgLatency: document.getElementById("avgLatency"),
  latencyCaption: document.getElementById("latencyCaption"),
  errorsTotal: document.getElementById("errorsTotal"),
  errorRate: document.getElementById("errorRate"),
  logsTotal: document.getElementById("logsTotal"),
  logsCaption: document.getElementById("logsCaption"),
  activeWorkers: document.getElementById("activeWorkers"),
  syntheticUsers: document.getElementById("syntheticUsers"),
  warningsTotal: document.getElementById("warningsTotal"),
  memoryRss: document.getElementById("memoryRss"),
  heapUsed: document.getElementById("heapUsed"),
  lastLatency: document.getElementById("lastLatency"),
  backgroundJobs: document.getElementById("backgroundJobs"),
  memoryHero: document.getElementById("memoryHero"),
  memoryMeter: document.getElementById("memoryMeter"),
  narrativeLead: document.getElementById("narrativeLead"),
  uptimeChip: document.getElementById("uptimeChip"),
  logDensityChip: document.getElementById("logDensityChip"),
  latencyChip: document.getElementById("latencyChip"),
  eventsList: document.getElementById("eventsList"),
};

function formatCompact(value) {
  return new Intl.NumberFormat("ru-RU", {
    notation: value > 9999 ? "compact" : "standard",
    maximumFractionDigits: value > 9999 ? 1 : 0,
  }).format(value);
}

function describeLatency(latency) {
  if (latency >= 600) {
    return "задержка уже болит";
  }
  if (latency >= 180) {
    return "задержка заметна";
  }
  return "задержка под контролем";
}

function formatUptime(startedAt) {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}ч ${minutes}м`;
  }
  if (minutes > 0) {
    return `${minutes}м ${seconds}с`;
  }
  return `${seconds}с`;
}

async function fetchStats() {
  const response = await fetch("/api/stats");
  if (!response.ok) {
    throw new Error("Failed to load stats");
  }
  return response.json();
}

function renderStats(stats) {
  const scenarioMeta = scenarioCopy[stats.scenario] || scenarioCopy.steady;
  const errorRate = stats.requestsTotal > 0 ? (stats.errorsTotal / stats.requestsTotal) * 100 : 0;
  const logDensity = stats.requestsTotal > 0 ? stats.logsTotal / stats.requestsTotal : 0;
  const memoryPercent = Math.max(6, Math.min((stats.memoryRssMb / 160) * 100, 100));

  document.body.dataset.scenario = stats.scenario;

  el.scenarioBadge.textContent = stats.scenario;
  el.scenarioDescription.textContent = scenarioMeta.description;

  el.requestsTotal.textContent = formatCompact(stats.requestsTotal);
  el.requestsCaption.textContent = `${stats.syntheticUsers} synthetic users держат поток живым`;

  el.avgLatency.textContent = `${stats.avgLatencyMs} ms`;
  el.latencyCaption.textContent = describeLatency(stats.avgLatencyMs);

  el.errorsTotal.textContent = formatCompact(stats.errorsTotal);
  el.errorRate.textContent = `${errorRate.toFixed(1)}% ошибок от общего потока`;

  el.logsTotal.textContent = formatCompact(stats.logsTotal);
  el.logsCaption.textContent = `${logDensity.toFixed(2)} логов на один запрос`;

  el.activeWorkers.textContent = stats.activeWorkers;
  el.syntheticUsers.textContent = stats.syntheticUsers;
  el.warningsTotal.textContent = formatCompact(stats.warningsTotal);
  el.memoryRss.textContent = `${stats.memoryRssMb} MB`;
  el.heapUsed.textContent = `${stats.heapUsedMb} MB`;
  el.lastLatency.textContent = `${stats.lastLatencyMs} ms`;
  el.backgroundJobs.textContent = stats.backgroundJobsStarted;
  el.memoryHero.textContent = `${stats.memoryRssMb} MB`;
  el.memoryMeter.style.width = `${memoryPercent}%`;

  el.narrativeLead.textContent = scenarioMeta.narrative;
  el.uptimeChip.textContent = `Uptime ${formatUptime(stats.startedAt)}`;
  el.logDensityChip.textContent = `${logDensity.toFixed(2)} логов / запрос`;
  el.latencyChip.textContent = describeLatency(stats.avgLatencyMs);

  el.eventsList.innerHTML = "";
  stats.events.forEach((event) => {
    const item = document.createElement("li");
    item.className = "timeline-item";
    item.innerHTML = `
      <span class="timeline-type">${event.type}</span>
      <div class="timeline-copy">
        <strong>${event.message}</strong>
        <small>${new Date(event.at).toLocaleTimeString("ru-RU")}</small>
      </div>
    `;
    el.eventsList.appendChild(item);
  });
}

async function refresh() {
  try {
    const stats = await fetchStats();
    renderStats(stats);
  } catch (error) {
    console.error(error);
  }
}

async function setScenario(scenario) {
  const response = await fetch(`/api/scenario/${scenario}`, { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to switch scenario");
  }
  await refresh();
}

document.querySelectorAll("[data-scenario]").forEach((button) => {
  button.addEventListener("click", () => {
    setScenario(button.dataset.scenario).catch(console.error);
  });
});

refresh();
setInterval(refresh, 2000);
