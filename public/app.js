const listEl = document.getElementById("list");
const bannerEl = document.getElementById("banner");
const notifBtn = document.getElementById("notif-btn");

const addSheet = document.getElementById("add-sheet");
const addForm = document.getElementById("add-form");
const restockSheet = document.getElementById("restock-sheet");
const restockForm = document.getElementById("restock-form");
let restockTargetId = null;

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

// ---------- Push notifications ----------

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function setupPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

  const reg = await navigator.serviceWorker.register("/service-worker.js");

  if (Notification.permission === "granted") {
    const sub = await reg.pushManager.getSubscription();
    if (sub) return; // already subscribed
  }

  if (Notification.permission === "denied") return;

  notifBtn.hidden = false;
  notifBtn.addEventListener("click", async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

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
    notifBtn.textContent = "🔔✓";
  });
}

setupPush().catch(console.error);
refresh().catch(err => {
  listEl.innerHTML = `<div class="empty-state">Couldn't load data: ${escapeHtml(err.message)}</div>`;
});
