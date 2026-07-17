const listEl = document.getElementById("list");
const bannerEl = document.getElementById("banner");
const notifBtn = document.getElementById("notif-btn");

const addSheet = document.getElementById("add-sheet");
const addForm = document.getElementById("add-form");
const restockSheet = document.getElementById("restock-sheet");
const restockForm = document.getElementById("restock-form");
let restockTargetId = null;

const reportSheet = document.getElementById("report-sheet");
const reportBody = document.getElementById("report-body");
const reportRange = document.getElementById("report-range");
let currentReportPeriod = "week";

const STATUS_LABEL = {
  ok: "OK",
  expiring_soon: "Order more soon",
  expired: "Expired",
  empty: "No stock",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Request failed");
  }
  return res.json();
}

function daysLeftLabel(days) {
  if (days === null || days === undefined) return "";
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  if (days === 0) return "expires today";
  return `${days}d left`;
}

function renderVitamins(vitamins) {
  if (!vitamins.length) {
    listEl.innerHTML = `<div class="empty-state">No vitamins yet. Tap + to add one.</div>`;
    return;
  }

  const soonCount = vitamins.filter(v => v.status === "expiring_soon").length;
  if (soonCount > 0) {
    bannerEl.hidden = false;
    bannerEl.textContent = `⚠️ ${soonCount} vitamin${soonCount > 1 ? "s" : ""} expiring within 7 days — time to order more.`;
  } else {
    bannerEl.hidden = true;
  }

  listEl.innerHTML = vitamins.map(v => {
    const note = v.status === "expiring_soon"
      ? `Reminder: order more — ${daysLeftLabel(v.daysLeft)}`
      : v.status === "expired"
      ? `Expired vial(s) in stock — ${daysLeftLabel(v.daysLeft)}`
      : v.status === "empty"
      ? "No stock on hand"
      : `Next expiration: ${daysLeftLabel(v.daysLeft)}`;

    const batchRows = v.batches.map(b => `
      <div class="batch-row">
        <span>${b.quantity} vial(s) received ${b.dateReceived}</span>
        <span class="badge status-${b.status}">${daysLeftLabel(b.daysLeft)}</span>
      </div>
    `).join("");

    return `
      <div class="card" data-id="${v.id}">
        <div class="card-top">
          <div>
            <p class="card-title">${escapeHtml(v.name)}</p>
            <p class="card-qty">${v.totalQuantity} vial${v.totalQuantity === 1 ? "" : "s"} in stock · shelf life ${v.shelfLifeDays}d</p>
          </div>
          <span class="status-pill status-${v.status}">${STATUS_LABEL[v.status]}</span>
        </div>
        <p class="card-note status-${v.status}">${note}</p>
        <div class="card-actions">
          <button class="btn secondary" data-action="use">Use 1</button>
          <button class="btn secondary" data-action="restock">+ Restock</button>
          <button class="btn danger" data-action="delete">Delete</button>
        </div>
        ${v.batches.length ? `<button class="batches-toggle" data-action="toggle-batches" data-count="${v.batches.length}">Show batches (${v.batches.length})</button>
        <div class="batches" hidden>${batchRows}</div>` : ""}
      </div>
    `;
  }).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function refresh() {
  const vitamins = await api("/api/vitamins");
  renderVitamins(vitamins);
}

listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const card = e.target.closest(".card");
  const id = card.dataset.id;
  const action = btn.dataset.action;

  if (action === "toggle-batches") {
    const batchesEl = card.querySelector(".batches");
    batchesEl.hidden = !batchesEl.hidden;
    const count = btn.dataset.count;
    btn.textContent = batchesEl.hidden ? `Show batches (${count})` : `Hide batches (${count})`;
    return;
  }

  try {
    if (action === "use") {
      await api(`/api/vitamins/${id}/use`, { method: "POST", body: JSON.stringify({ quantity: 1 }) });
      await refresh();
    } else if (action === "restock") {
      restockTargetId = id;
      document.getElementById("restock-name").textContent = card.querySelector(".card-title").textContent;
      document.getElementById("r-qty").value = 1;
      document.getElementById("r-date").value = todayStr();
      restockSheet.hidden = false;
    } else if (action === "delete") {
      if (confirm("Delete this vitamin and all its stock records?")) {
        await api(`/api/vitamins/${id}`, { method: "DELETE" });
        await refresh();
      }
    }
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("add-fab").addEventListener("click", () => {
  document.getElementById("f-name").value = "";
  document.getElementById("f-shelf").value = 28;
  document.getElementById("f-qty").value = 0;
  document.getElementById("f-date").value = todayStr();
  addSheet.hidden = false;
});

document.getElementById("add-cancel").addEventListener("click", () => addSheet.hidden = true);
addSheet.addEventListener("click", (e) => { if (e.target === addSheet) addSheet.hidden = true; });

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/vitamins", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("f-name").value.trim(),
        shelfLifeDays: Number(document.getElementById("f-shelf").value),
        quantity: Number(document.getElementById("f-qty").value),
        dateReceived: document.getElementById("f-date").value,
      }),
    });
    addSheet.hidden = true;
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("restock-cancel").addEventListener("click", () => restockSheet.hidden = true);
restockSheet.addEventListener("click", (e) => { if (e.target === restockSheet) restockSheet.hidden = true; });

restockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api(`/api/vitamins/${restockTargetId}/restock`, {
      method: "POST",
      body: JSON.stringify({
        quantity: Number(document.getElementById("r-qty").value),
        dateReceived: document.getElementById("r-date").value,
      }),
    });
    restockSheet.hidden = true;
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Usage report ----------

async function loadReport(period) {
  currentReportPeriod = period;
  document.querySelectorAll(".period-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.period === period);
  });

  const report = await api(`/api/report?period=${period}`);
  reportRange.textContent = `${report.periodLabel} (${report.rangeStart} to ${report.rangeEnd})`;

  if (!report.breakdown.length) {
    reportBody.innerHTML = `<div class="report-empty">No vials used ${report.periodLabel.toLowerCase()}.</div>`;
    return;
  }

  const rows = report.breakdown.map(r => `
    <div class="report-row">
      <span>${escapeHtml(r.name)}</span>
      <span class="qty">${r.quantity}</span>
    </div>
  `).join("");

  reportBody.innerHTML = `
    ${rows}
    <div class="report-total"><span>Total</span><span>${report.total}</span></div>
  `;
}

document.getElementById("report-btn").addEventListener("click", () => {
  reportSheet.hidden = false;
  loadReport(currentReportPeriod).catch(err => alert(err.message));
});

document.querySelectorAll(".period-tab").forEach(btn => {
  btn.addEventListener("click", () => loadReport(btn.dataset.period).catch(err => alert(err.message)));
});

document.getElementById("report-close").addEventListener("click", () => reportSheet.hidden = true);
reportSheet.addEventListener("click", (e) => { if (e.target === reportSheet) reportSheet.hidden = true; });

document.getElementById("report-reset").addEventListener("click", async () => {
  const sure = confirm(
    "This will permanently delete ALL vial usage history recorded to date. " +
    "This cannot be undone. Are you sure you want to reset the report?"
  );
  if (!sure) return;
  try {
    await api("/api/report/reset", { method: "POST" });
    await loadReport(currentReportPeriod);
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Push notifications ----------

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function updateNotifButton(reg) {
  if (Notification.permission === "denied") {
    notifBtn.textContent = "🔕";
    notifBtn.title = "Notifications blocked — enable them in your browser/phone settings";
    notifBtn.disabled = true;
    return;
  }
  const sub = await reg.pushManager.getSubscription();
  notifBtn.disabled = false;
  if (Notification.permission === "granted" && sub) {
    notifBtn.textContent = "🔔✓";
    notifBtn.title = "Reminders enabled";
  } else {
    notifBtn.textContent = "🔔";
    notifBtn.title = "Enable reminders";
  }
}

async function setupPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    notifBtn.hidden = true;
    return;
  }

  const reg = await navigator.serviceWorker.register("/service-worker.js");
  notifBtn.hidden = false;
  await updateNotifButton(reg);

  notifBtn.addEventListener("click", async () => {
    if (Notification.permission === "denied") {
      alert("Notifications are blocked for this site. Enable them in your browser/phone settings, then reload the page.");
      return;
    }

    const permission = await Notification.requestPermission();
    await updateNotifButton(reg);
    if (permission !== "granted") return;

    const existing = await reg.pushManager.getSubscription();
    if (existing) return; // already subscribed, nothing more to do

    const { publicKey } = await api("/api/push/public-key");
    if (!publicKey) {
      alert("Push isn't configured on the server yet.");
      return;
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await api("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
    await updateNotifButton(reg);
  });
}

setupPush().catch(console.error);
refresh().catch(err => {
  listEl.innerHTML = `<div class="empty-state">Couldn't load data: ${escapeHtml(err.message)}</div>`;
});
