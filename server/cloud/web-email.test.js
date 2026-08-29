import assert from "node:assert/strict";
import test from "node:test";
import { ResendWebEmailService, SmtpWebEmailService } from "./web-email.js";

test("Resend email service sends a password reset message without exposing the API key", async () => {
  let request = null;
  const service = new ResendWebEmailService({
    apiKey: "re_test_secret",
    from: "SHEIN 涵舟工作室 <no-reply@example.com>",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, status: 200 };
    },
  });

  await service.sendPasswordReset({
    to: "member@example.com",
    resetUrl: "https://app.example.test/reset-password?token=swr_test",
    expiresAt: "2026-08-23T12:30:00.000Z",
  });

  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.init.headers.Authorization, "Bearer re_test_secret");
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body.to, ["member@example.com"]);
  assert.match(body.text, /reset-password\?token=swr_test/);
  assert.equal(body.text.includes("re_test_secret"), false);
});

test("Resend email service fails closed when the provider rejects the message", async () => {
  const service = new ResendWebEmailService({
    apiKey: "re_test_secret",
    from: "no-reply@example.com",
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });

  await assert.rejects(
    () => service.sendPasswordReset({
      to: "member@example.com",
      resetUrl: "https://app.example.test/reset-password?token=swr_test",
      expiresAt: "2026-08-23T12:30:00.000Z",
    }),
    (error) => error.code === "EMAIL_PROVIDER_REJECTED" && error.status === 503,
  );
});

test("SMTP email service sends a password reset message through an authenticated TLS session", async () => {
  const writes = [];
  const responses = [
    "220 smtp.163.com ready\r\n",
    "250-smtp.163.com\r\n250-AUTH LOGIN\r\n250 OK\r\n",
    "334 VXNlcm5hbWU6\r\n",
    "334 UGFzc3dvcmQ6\r\n",
    "235 2.7.0 Authentication successful\r\n",
    "250 2.0.0 OK\r\n",
    "250 2.0.0 OK\r\n",
    "354 End data with <CR><LF>.<CR><LF>\r\n",
    "250 2.0.0 queued\r\n",
    "221 2.0.0 bye\r\n",
  ];
  let greetingSent = false;
  const socket = {
    on(event, handler) {
      if (event === "data") {
        this.onData = handler;
        if (!greetingSent) {
          greetingSent = true;
          queueMicrotask(() => this.onData?.(Buffer.from(responses.shift())));
        }
      }
      return this;
    },
    once(event, handler) {
      if (event === "error") this.onError = handler;
      if (event === "close") this.onClose = handler;
      return this;
    },
    removeListener() {
      return this;
    },
    setTimeout() {
      return this;
    },
    write(command) {
      writes.push(command);
      const response = responses.shift();
      queueMicrotask(() => this.onData?.(Buffer.from(response)));
      return true;
    },
    end() {},
  };

  const service = new SmtpWebEmailService({
    host: "smtp.163.com",
    port: 465,
    user: "thw2023zl@163.com",
    password: "smtp-secret",
    from: "SHEIN超级运营中心 <thw2023zl@163.com>",
    connectionFactory: () => socket,
  });

  await service.sendPasswordReset({
    to: "member@example.com",
    resetUrl: "https://app.example.test/reset-password?token=swr_test",
    expiresAt: "2026-08-23T12:30:00.000Z",
  });

  assert.equal(writes[0], "EHLO shein-console\r\n");
  assert.equal(writes[1], "AUTH LOGIN\r\n");
  assert.equal(writes[2], "dGh3MjAyM3psQDE2My5jb20=\r\n");
  assert.equal(writes[3], "c210cC1zZWNyZXQ=\r\n");
  assert.equal(writes[4], "MAIL FROM:<thw2023zl@163.com>\r\n");
  assert.equal(writes[5], "RCPT TO:<member@example.com>\r\n");
  assert.equal(writes[6], "DATA\r\n");
  assert.match(writes[7], /To: member@example\.com/);
  assert.match(writes[7], /reset-password\?token=swr_test/);
  assert.equal(writes.at(-1), "QUIT\r\n");
  assert.equal(writes.some((value) => value.includes("smtp-secret")), false);
});
