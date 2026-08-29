import tls from "node:tls";

export class WebEmailError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = "WebEmailError";
    this.code = code;
    this.status = status;
  }
}

function cleanText(value, name) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new WebEmailError("EMAIL_CONFIG_INVALID", `${name}未配置`);
  return text;
}

function cleanPort(value) {
  const port = Number(value || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new WebEmailError("EMAIL_CONFIG_INVALID", "SHEIN_SMTP_PORT配置无效");
  }
  return port;
}

function envelopeAddress(value) {
  const text = cleanText(value, "SHEIN_EMAIL_FROM");
  const match = text.match(/<([^<>\s]+@[^<>\s]+)>/);
  return match ? match[1] : text;
}

function encodeHeader(value) {
  const text = String(value || "");
  return /^[\x00-\x7F]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function buildMessage({ from, to, replyTo, resetUrl, expiresAt }) {
  const body = [
    "你正在请求重置 SHEIN 超级运营中心的登录密码。",
    "",
    `请打开以下链接设置新密码：${resetUrl}`,
    `链接有效至：${expiresAt}`,
    "",
    "如果不是你本人操作，请忽略此邮件。",
  ].join("\n");
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader("SHEIN 超级运营中心 · 重置登录密码")}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
  ];
  return `${headers.join("\r\n")}\r\n\r\n${body.replace(/^\./gm, "..")}`;
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const cleanup = () => {
      socket.removeListener?.("data", onData);
      socket.removeListener?.("error", onError);
      socket.removeListener?.("close", onClose);
    };
    const onError = () => {
      cleanup();
      reject(new WebEmailError("EMAIL_PROVIDER_REJECTED", "邮件服务连接失败"));
    };
    const onClose = () => {
      cleanup();
      reject(new WebEmailError("EMAIL_PROVIDER_REJECTED", "邮件服务连接已关闭"));
    };
    const onData = (chunk) => {
      buffer += Buffer.from(chunk).toString("utf8");
      const lines = buffer.split("\r\n");
      const completeLines = lines.slice(0, -1);
      const finalLine = completeLines.at(-1) || "";
      if (!/^\d{3} /.test(finalLine)) return;
      cleanup();
      resolve({
        code: Number(finalLine.slice(0, 3)),
        text: completeLines.join("\n"),
      });
    };
    socket.on("data", onData);
    socket.once?.("error", onError);
    socket.once?.("close", onClose);
  });
}

async function expectResponse(socket, expectedCodes) {
  const response = await readResponse(socket);
  if (!expectedCodes.includes(response.code)) {
    throw new WebEmailError("EMAIL_PROVIDER_REJECTED", "邮件服务拒绝发送");
  }
  return response;
}

async function sendCommand(socket, command, expectedCodes) {
  socket.write(`${command}\r\n`);
  return expectResponse(socket, expectedCodes);
}

function connectTls({ host, port, timeoutMs, connectionFactory }) {
  if (connectionFactory) return Promise.resolve(connectionFactory({ host, port, timeoutMs }));
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: host,
      timeout: timeoutMs,
    });
    const onError = () => reject(new WebEmailError("EMAIL_PROVIDER_REJECTED", "邮件服务连接失败"));
    socket.once("secureConnect", () => {
      socket.removeListener("error", onError);
      resolve(socket);
    });
    socket.once("error", onError);
  });
}

export class ResendWebEmailService {
  constructor({ apiKey, from, replyTo = "", fetchImpl = fetch } = {}) {
    this.apiKey = cleanText(apiKey, "SHEIN_EMAIL_API_KEY");
    this.from = cleanText(from, "SHEIN_EMAIL_FROM");
    this.replyTo = String(replyTo || "").trim();
    this.fetch = fetchImpl;
  }

  async sendPasswordReset({ to, resetUrl, expiresAt } = {}) {
    const response = await this.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [cleanText(to, "收件邮箱")],
        subject: "SHEIN超级运营中心 · 重置登录密码",
        ...(this.replyTo ? { reply_to: this.replyTo } : {}),
        text: [
          "你正在请求重置 SHEIN超级运营中心的登录密码。",
          "",
          `请打开以下链接设置新密码：${resetUrl}`,
          `链接有效至：${expiresAt}`,
          "",
          "如果不是你本人操作，请忽略此邮件。",
        ].join("\n"),
      }),
    });
    if (!response.ok) {
      throw new WebEmailError("EMAIL_PROVIDER_REJECTED", "邮件服务拒绝发送");
    }
    return { delivered: true };
  }
}

export class SmtpWebEmailService {
  constructor({
    host,
    port = 465,
    secure = true,
    user,
    password,
    from,
    replyTo = "",
    timeoutMs = 15000,
    connectionFactory,
  } = {}) {
    this.host = cleanText(host, "SHEIN_SMTP_HOST");
    this.port = cleanPort(port);
    if (!secure || this.port !== 465) {
      throw new WebEmailError(
        "EMAIL_CONFIG_INVALID",
        "当前SMTP适配仅支持465端口SSL连接",
      );
    }
    this.user = cleanText(user, "SHEIN_SMTP_USER");
    this.password = cleanText(password, "SHEIN_SMTP_PASSWORD");
    this.from = cleanText(from, "SHEIN_EMAIL_FROM");
    this.fromAddress = envelopeAddress(this.from);
    this.replyTo = String(replyTo || "").trim();
    this.timeoutMs = timeoutMs;
    this.connectionFactory = connectionFactory;
  }

  async sendPasswordReset({ to, resetUrl, expiresAt } = {}) {
    const recipient = cleanText(to, "收件邮箱");
    let socket;
    try {
      socket = await connectTls({
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        connectionFactory: this.connectionFactory,
      });
      await expectResponse(socket, [220]);
      await sendCommand(socket, "EHLO shein-console", [250]);
      await sendCommand(socket, "AUTH LOGIN", [334]);
      await sendCommand(socket, Buffer.from(this.user, "utf8").toString("base64"), [334]);
      await sendCommand(socket, Buffer.from(this.password, "utf8").toString("base64"), [235]);
      await sendCommand(socket, `MAIL FROM:<${this.fromAddress}>`, [250]);
      await sendCommand(socket, `RCPT TO:<${recipient}>`, [250, 251]);
      socket.write("DATA\r\n");
      await expectResponse(socket, [354]);
      const message = buildMessage({
        from: this.from,
        to: recipient,
        replyTo: this.replyTo,
        resetUrl,
        expiresAt,
      });
      socket.write(`${message}\r\n.\r\n`);
      await expectResponse(socket, [250]);
      await sendCommand(socket, "QUIT", [221]);
      return { delivered: true };
    } catch (error) {
      if (error instanceof WebEmailError) throw error;
      throw new WebEmailError("EMAIL_PROVIDER_REJECTED", "邮件服务拒绝发送");
    } finally {
      socket?.end?.();
    }
  }
}
