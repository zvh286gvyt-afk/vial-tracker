import os
import uuid
from datetime import date, datetime, timedelta

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

import storage

load_dotenv()

try:
    from pywebpush import webpush, WebPushException
except ImportError:
    webpush = None
    WebPushException = Exception

app = Flask(__name__, static_folder="public", static_url_path="")

DEFAULT_SHELF_LIFE_DAYS = 28
REMINDER_WINDOW_DAYS = 7
CRON_SECRET = os.environ.get("CRON_SECRET", "dev-secret")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_CLAIMS_EMAIL = os.environ.get("VAPID_CLAIMS_EMAIL", "mailto:admin@example.com")


def today():
    return date.today()


def parse_date(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def fmt_date(d):
    return d.strftime("%Y-%m-%d")


def batch_status(expiration_date_str):
    days_left = (parse_date(expiration_date_str) - today()).days
    if days_left < 0:
        return "expired", days_left
    if days_left <= REMINDER_WINDOW_DAYS:
        return "expiring_soon", days_left
    return "ok", days_left


def serialize_vitamin(v):
    batches = sorted(v["batches"], key=lambda b: b["expirationDate"])
    total_quantity = sum(b["quantity"] for b in batches)
    out_batches = []
    nearest_status = "ok"
    nearest_days_left = None
    for b in batches:
        status, days_left = batch_status(b["expirationDate"])
        out_batches.append({
            **b,
            "status": status,
            "daysLeft": days_left,
        })
        if nearest_days_left is None or days_left < nearest_days_left:
            nearest_days_left = days_left
            nearest_status = status
    return {
        "id": v["id"],
        "name": v["name"],
        "shelfLifeDays": v["shelfLifeDays"],
        "totalQuantity": total_quantity,
        "status": nearest_status if batches else "empty",
        "daysLeft": nearest_days_left,
        "batches": out_batches,
    }


# ---------- Static frontend ----------

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# ---------- Vitamin API ----------

@app.route("/api/vitamins", methods=["GET"])
def list_vitamins():
    store = storage.load()
    vitamins = [serialize_vitamin(v) for v in store["vitamins"]]
    vitamins.sort(key=lambda v: (v["daysLeft"] is None, v["daysLeft"]))
    return jsonify(vitamins)


@app.route("/api/vitamins", methods=["POST"])
def create_vitamin():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400

    shelf_life_days = int(data.get("shelfLifeDays") or DEFAULT_SHELF_LIFE_DAYS)
    quantity = int(data.get("quantity") or 0)
    date_received_str = data.get("dateReceived") or fmt_date(today())
    date_received = parse_date(date_received_str)
    expiration = fmt_date(date_received + timedelta(days=shelf_life_days))

    store = storage.load()
    vitamin = {
        "id": str(uuid.uuid4()),
        "name": name,
        "shelfLifeDays": shelf_life_days,
        "batches": [],
    }
    if quantity > 0:
        vitamin["batches"].append({
            "id": str(uuid.uuid4()),
            "quantity": quantity,
            "dateReceived": date_received_str,
            "expirationDate": expiration,
            "notified": False,
        })
    store["vitamins"].append(vitamin)
    storage.save(store)
    return jsonify(serialize_vitamin(vitamin)), 201


@app.route("/api/vitamins/<vitamin_id>", methods=["DELETE"])
def delete_vitamin(vitamin_id):
    store = storage.load()
    before = len(store["vitamins"])
    store["vitamins"] = [v for v in store["vitamins"] if v["id"] != vitamin_id]
    if len(store["vitamins"]) == before:
        return jsonify({"error": "Not found"}), 404
    storage.save(store)
    return jsonify({"ok": True})


@app.route("/api/vitamins/<vitamin_id>/restock", methods=["POST"])
def restock_vitamin(vitamin_id):
    data = request.get_json(force=True) or {}
    quantity = int(data.get("quantity") or 0)
    if quantity <= 0:
        return jsonify({"error": "Quantity must be positive"}), 400

    date_received_str = data.get("dateReceived") or fmt_date(today())
    date_received = parse_date(date_received_str)

    store = storage.load()
    vitamin = next((v for v in store["vitamins"] if v["id"] == vitamin_id), None)
    if not vitamin:
        return jsonify({"error": "Not found"}), 404

    expiration = fmt_date(date_received + timedelta(days=vitamin["shelfLifeDays"]))
    vitamin["batches"].append({
        "id": str(uuid.uuid4()),
        "quantity": quantity,
        "dateReceived": date_received_str,
        "expirationDate": expiration,
        "notified": False,
    })
    storage.save(store)
    return jsonify(serialize_vitamin(vitamin))


@app.route("/api/vitamins/<vitamin_id>/use", methods=["POST"])
def use_vitamin(vitamin_id):
    data = request.get_json(force=True) or {}
    quantity = int(data.get("quantity") or 1)
    if quantity <= 0:
        return jsonify({"error": "Quantity must be positive"}), 400

    store = storage.load()
    vitamin = next((v for v in store["vitamins"] if v["id"] == vitamin_id), None)
    if not vitamin:
        return jsonify({"error": "Not found"}), 404

    available = sum(b["quantity"] for b in vitamin["batches"])
    if quantity > available:
        return jsonify({"error": "Not enough stock"}), 400

    vitamin["batches"].sort(key=lambda b: b["expirationDate"])
    remaining = quantity
    new_batches = []
    for b in vitamin["batches"]:
        if remaining <= 0:
            new_batches.append(b)
            continue
        if b["quantity"] <= remaining:
            remaining -= b["quantity"]
        else:
            b["quantity"] -= remaining
            remaining = 0
            new_batches.append(b)
    vitamin["batches"] = new_batches
    storage.save(store)
    return jsonify(serialize_vitamin(vitamin))


# ---------- Push notifications ----------

@app.route("/api/push/public-key", methods=["GET"])
def push_public_key():
    return jsonify({"publicKey": VAPID_PUBLIC_KEY})


@app.route("/api/push/subscribe", methods=["POST"])
def push_subscribe():
    subscription = request.get_json(force=True)
    if not subscription or "endpoint" not in subscription:
        return jsonify({"error": "Invalid subscription"}), 400
    store = storage.load()
    existing = [s for s in store["subscriptions"] if s["endpoint"] == subscription["endpoint"]]
    if not existing:
        store["subscriptions"].append(subscription)
        storage.save(store)
    return jsonify({"ok": True})


@app.route("/api/push/unsubscribe", methods=["POST"])
def push_unsubscribe():
    data = request.get_json(force=True) or {}
    endpoint = data.get("endpoint")
    store = storage.load()
    store["subscriptions"] = [s for s in store["subscriptions"] if s["endpoint"] != endpoint]
    storage.save(store)
    return jsonify({"ok": True})


def send_push(subscription, payload):
    if webpush is None or not VAPID_PRIVATE_KEY:
        return False
    try:
        webpush(
            subscription_info=subscription,
            data=payload,
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_CLAIMS_EMAIL},
        )
        return True
    except WebPushException:
        return False


@app.route("/api/cron/check-expirations", methods=["GET", "POST"])
def check_expirations():
    key = request.args.get("key") or (request.get_json(silent=True) or {}).get("key")
    if key != CRON_SECRET:
        return jsonify({"error": "Forbidden"}), 403

    store = storage.load()
    dead_endpoints = set()
    notified_count = 0

    for vitamin in store["vitamins"]:
        for batch in vitamin["batches"]:
            status, days_left = batch_status(batch["expirationDate"])
            if status == "expiring_soon" and not batch.get("notified"):
                message = {
                    "title": "Vial expiring soon",
                    "body": f"{vitamin['name']}: {batch['quantity']} vial(s) expire in {days_left} day(s). Time to order more.",
                }
                import json as _json
                for sub in store["subscriptions"]:
                    if sub["endpoint"] in dead_endpoints:
                        continue
                    ok = send_push(sub, _json.dumps(message))
                    if not ok:
                        dead_endpoints.add(sub["endpoint"])
                batch["notified"] = True
                notified_count += 1

    if dead_endpoints:
        store["subscriptions"] = [s for s in store["subscriptions"] if s["endpoint"] not in dead_endpoints]

    storage.save(store)
    return jsonify({"ok": True, "notifiedBatches": notified_count})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=True)
