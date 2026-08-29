import { randomBytes } from "node:crypto";
import { maskCredential } from "./shein-crypto.js";

const AUTH_STATE_TTL_MS = 10 * 60 * 1000;

export class StoreRegistry {
  #stores = new Map();
  #authorizationStates = new Map();
  #vault;

  constructor({ vault = null } = {}) {
    this.#vault = vault;
    if (!vault) return;

    for (const credentials of vault.load()) {
      const id = String(credentials.supplierId || credentials.openKeyId);
      this.#stores.set(id, {
        ...credentials,
        id,
        status: credentials.status || "active",
      });
    }
  }

  createAuthorizationState() {
    this.#purgeExpiredStates();
    const state = `SHEIN-${Date.now()}-${randomBytes(12).toString("hex")}`;
    this.#authorizationStates.set(state, Date.now() + AUTH_STATE_TTL_MS);
    return state;
  }

  consumeAuthorizationState(state) {
    this.#purgeExpiredStates();
    const expiresAt = this.#authorizationStates.get(state);
    this.#authorizationStates.delete(state);
    return Boolean(expiresAt && expiresAt >= Date.now());
  }

  upsertStore(credentials) {
    const id = String(credentials.supplierId || credentials.openKeyId);
    const existing = this.#stores.get(id);
    const store = {
      ...existing,
      ...credentials,
      id,
      status: credentials.status || existing?.status || "active",
      connectedAt: new Date().toISOString(),
    };
    this.#stores.set(id, store);
    this.#persist();
    return this.toPublicStore(store);
  }

  getStore(id) {
    return this.#stores.get(String(id)) ?? null;
  }

  renameStore(id, label) {
    const store = this.#stores.get(String(id));
    if (!store) return null;
    store.label = label;
    this.#persist();
    return this.toPublicStore(store);
  }

  markReauthorizationRequired(id) {
    const store = this.#stores.get(String(id));
    if (!store) return null;
    if (store.status !== "reauthorization_required") {
      store.status = "reauthorization_required";
      store.reauthorizationAt = new Date().toISOString();
      this.#persist();
    }
    return this.toPublicStore(store);
  }

  removeStore(id) {
    const removed = this.#stores.delete(String(id));
    if (removed) this.#persist();
    return removed;
  }

  listStores() {
    return Array.from(this.#stores.values(), (store) => this.toPublicStore(store));
  }

  toPublicStore(store) {
    return {
      id: store.id,
      supplierId: store.supplierId ?? null,
      label: store.label || `SHEIN 店铺 ${store.supplierId || "未命名"}`,
      businessMode: store.businessMode || "全托管",
      openKeyIdMasked: maskCredential(store.openKeyId),
      connectedAt: store.connectedAt,
      source: store.source || "authorization",
      status: store.status || "active",
    };
  }

  #purgeExpiredStates() {
    const now = Date.now();
    for (const [state, expiresAt] of this.#authorizationStates) {
      if (expiresAt < now) this.#authorizationStates.delete(state);
    }
  }

  #persist() {
    if (!this.#vault) return;
    this.#vault.save(
      Array.from(this.#stores.values(), (store) => ({
        openKeyId: store.openKeyId,
        secretKey: store.secretKey,
        supplierId: store.supplierId,
        label: store.label,
        businessMode: store.businessMode,
        connectedAt: store.connectedAt,
        source: store.source,
        status: store.status || "active",
        reauthorizationAt: store.reauthorizationAt,
      })),
    );
  }
}
