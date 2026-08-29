function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export class CloudDesktopClientError extends Error {
  constructor(message, { status = 500, code = "CLOUD_REQUEST_FAILED" } = {}) {
    super(message);
    this.name = "CloudDesktopClientError";
    this.status = status;
    this.code = code;
  }
}

export class CloudDesktopClient {
  constructor({ baseUrl, vault, fetchImpl = fetch } = {}) {
    if (!baseUrl) throw new Error("CloudDesktopClient 缺少 baseUrl");
    if (!vault) throw new Error("CloudDesktopClient 缺少 vault");
    this.baseUrl = stripTrailingSlash(baseUrl);
    this.vault = vault;
    this.fetchImpl = fetchImpl;
  }

  getLocalStatus() {
    const value = this.vault.getOrCreateInstallation();
    const session = value.session;
    return {
      configured: true,
      connected: Boolean(session?.accessToken),
      tenant: session?.tenant || null,
      device: session?.device || null,
      expiresAt: session?.expiresAt || null,
      cloudBaseUrl: this.baseUrl,
    };
  }

  async enroll({ code, deviceName }) {
    const value = this.vault.getOrCreateInstallation();
    const payload = await this.#request("/v1/auth/enroll", {
      method: "POST",
      body: {
        code,
        deviceName,
        installationId: value.installationId,
      },
      authenticated: false,
    });
    this.vault.saveSession({
      accessToken: payload.accessToken,
      tokenType: payload.tokenType,
      expiresAt: payload.expiresAt,
      tenant: payload.tenant,
      device: payload.device,
    });
    return this.getLocalStatus();
  }

  async startSheinAuthorization({ deviceName }) {
    const value = this.vault.getOrCreateInstallation();
    return this.#request("/v1/shein/auth/start", {
      method: "POST",
      body: {
        installationId: value.installationId,
        deviceName,
      },
      authenticated: Boolean(value.session?.accessToken),
    });
  }

  async completeSheinAuthorization({
    state,
    tempToken,
    deviceName,
  }) {
    const value = this.vault.getOrCreateInstallation();
    const payload = await this.#request("/v1/shein/auth/complete", {
      method: "POST",
      body: {
        state,
        tempToken,
        deviceName,
        installationId: value.installationId,
      },
      authenticated: Boolean(value.session?.accessToken),
    });
    this.vault.saveSession({
      accessToken: payload.accessToken,
      tokenType: payload.tokenType,
      expiresAt: payload.expiresAt,
      tenant: payload.tenant,
      device: payload.device,
    });
    return {
      status: this.getLocalStatus(),
      store: payload.store,
      diagnostics: payload.diagnostics || null,
    };
  }

  async verify() {
    const payload = await this.#request("/v1/session", {
      method: "GET",
    });
    const value = this.vault.getOrCreateInstallation();
    this.vault.saveSession({
      ...value.session,
      expiresAt: payload.expiresAt,
      tenant: payload.tenant,
      device: payload.device,
    });
    return {
      ...this.getLocalStatus(),
      verified: true,
    };
  }

  async listWebhookAudits({ supplierId = "", limit = 50 } = {}) {
    const search = new URLSearchParams();
    if (supplierId) search.set("supplierId", String(supplierId));
    search.set("limit", String(limit));
    return this.#request(`/v1/webhook-audits?${search.toString()}`, {
      method: "GET",
    });
  }

  async disconnect() {
    try {
      await this.#request("/v1/auth/logout", {
        method: "POST",
      });
      this.vault.clearSession();
    } catch (error) {
      if (
        error instanceof CloudDesktopClientError &&
        error.status === 401
      ) {
        this.vault.clearSession();
      } else {
        throw error;
      }
    }
    return this.getLocalStatus();
  }

  async #request(pathname, {
    method,
    body = undefined,
    authenticated = true,
  }) {
    const headers = {
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authenticated) {
      const accessToken =
        this.vault.getOrCreateInstallation().session?.accessToken;
      if (!accessToken) {
        throw new CloudDesktopClientError("当前电脑尚未连接云端", {
          status: 401,
          code: "CLOUD_NOT_CONNECTED",
        });
      }
      headers.Authorization = `Bearer ${accessToken}`;
    }
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new CloudDesktopClientError("无法连接云端服务，请检查网络", {
        status: 503,
        code: "CLOUD_UNREACHABLE",
      });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new CloudDesktopClientError(
        payload.msg || "云端请求失败",
        {
          status: response.status,
          code: payload.code || "CLOUD_REQUEST_FAILED",
        },
      );
    }
    return payload;
  }
}
