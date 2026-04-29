const el = {
  scenarioBadge: document.getElementById("scenarioBadge"),
  requestsTotal: document.getElementById("requestsTotal"),
  avgLatency: document.getElementById("avgLatency"),
  errorsTotal: document.getElementById("errorsTotal"),
  logsTotal: document.getElementById("logsTotal"),
  activeWorkers: document.getElementById("activeWorkers"),
  syntheticUsers: document.getElementById("syntheticUsers"),
  warningsTotal: document.getElementById("warningsTotal"),
  memoryRss: document.getElementById("memoryRss"),
  heapUsed: document.getElementById("heapUsed"),
  lastLatency: document.getElementById("lastLatency"),
  eventsList: document.getElementById("eventsList"),
};

async function fetchStats() {
  const response = await fetch("/api/stats");
  if (!response.ok) {
    throw new Error("Failed to load stats");
  }
  return response.json();
}

function renderStats(stats) {
  el.scenarioBadge.textContent = stats.scenario;
  el.requestsTotal.textContent = stats.requestsTotal;
  el.avgLatency.textContent = `${stats.avgLatencyMs} ms`;
  el.errorsTotal.textContent = stats.errorsTotal;
  el.logsTotal.textContent = stats.logsTotal;
  el.activeWorkers.textContent = stats.activeWorkers;
  el.syntheticUsers.textContent = stats.syntheticUsers;
  el.warningsTotal.textContent = stats.warningsTotal;
  el.memoryRss.textContent = `${stats.memoryRssMb} MB`;
  el.heapUsed.textContent = `${stats.heapUsedMb} MB`;
  el.lastLatency.textContent = `${stats.lastLatencyMs} ms`;

  el.eventsList.innerHTML = "";
  stats.events.forEach((event) => {
    const item = document.createElement("li");
    item.className = "event-item";
    item.innerHTML = `
      <span class="event-type">${event.type}</span>
      <div>
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
