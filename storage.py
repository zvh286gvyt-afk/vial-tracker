import json
import os
import threading

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DATA_FILE = os.path.join(DATA_DIR, "store.json")

_lock = threading.Lock()

_DEFAULT_STORE = {
    "vitamins": [],
    "subscriptions": [],
    "usageLog": [],
}


def _ensure_file():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, "w") as f:
            json.dump(_DEFAULT_STORE, f, indent=2)


def load():
    _ensure_file()
    with _lock:
        with open(DATA_FILE, "r") as f:
            store = json.load(f)
    for key, default in _DEFAULT_STORE.items():
        store.setdefault(key, default)
    return store


def save(store):
    _ensure_file()
    with _lock:
        tmp_path = DATA_FILE + ".tmp"
        with open(tmp_path, "w") as f:
            json.dump(store, f, indent=2)
        os.replace(tmp_path, DATA_FILE)
