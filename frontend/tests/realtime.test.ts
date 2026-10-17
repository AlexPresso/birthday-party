import test from "node:test";
import assert from "node:assert/strict";
import { createRealtimeClient } from "../src/lib/realtime.ts";

class Socket {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closes = 0;

  close() {
    this.closes++;
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  end(code = 1006) {
    this.onclose?.({ code } as CloseEvent);
  }
}

function harness() {
  const sockets: Socket[] = [];
  let visible = true;
  let resume = () => {};
  let watches = 0;
  let stopped = 0;
  let expired = 0;
  const client = createRealtimeClient({
    connect: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    available: () => visible,
    onExpired: () => expired++,
    watch: (callback) => {
      watches++;
      resume = callback;
      return () => stopped++;
    },
    random: () => 0,
  });
  return {
    client,
    sockets,
    availability(value: boolean) {
      visible = value;
      resume();
    },
    counts: () => ({ watches, stopped, expired }),
  };
}

test("resources share one socket and only validated affected topics refresh", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = harness();
  const reads = { welcome: 0, uploads: 0 };
  const connected: boolean[] = [];
  const stopWelcome = app.client.subscribe(
    "welcome",
    () => reads.welcome++,
    (value) => connected.push(value),
  );
  const stopUploads = app.client.subscribe(
    "uploads",
    () => reads.uploads++,
    () => {},
  );
  assert.equal(app.sockets.length, 1);
  assert.deepEqual(reads, { welcome: 1, uploads: 1 });
  const socket = app.sockets[0];
  socket.receive({ type: "invalidate", topics: ["welcome"] });
  assert.equal(reads.welcome, 1, "invalidations wait for the ready handshake");
  socket.receive({ type: "ready" });
  assert.deepEqual(reads, { welcome: 2, uploads: 2 });
  assert.deepEqual(connected, [true]);
  socket.receive({ type: "invalidate", topics: ["uploads", "uploads"] });
  assert.deepEqual(reads, { welcome: 2, uploads: 3 });
  for (const message of [
    { type: "heartbeat" },
    { type: "invalidate", topics: ["welcome", "private"] },
    { type: "invalidate", topics: [] },
    {
      type: "invalidate",
      topics: ["welcome", "welcome", "welcome", "welcome"],
    },
    { type: "unknown" },
    "x".repeat(2048),
    null,
  ])
    socket.receive(message);
  socket.onmessage?.({ data: "{" } as MessageEvent);
  socket.onmessage?.({ data: new ArrayBuffer(8) } as MessageEvent);
  assert.deepEqual(reads, { welcome: 2, uploads: 3 });
  const staleMessage = socket.onmessage;
  stopWelcome();
  assert.equal(socket.closes, 0);
  stopUploads();
  assert.equal(socket.closes, 1);
  staleMessage?.({ data: '{"type":"ready"}' } as MessageEvent);
  t.mock.timers.tick(120000);
  assert.equal(app.sockets.length, 1);
  assert.deepEqual(reads, { welcome: 2, uploads: 3 });
  assert.deepEqual(app.counts(), { watches: 1, stopped: 1, expired: 0 });
});

test("reconnect uses bounded backoff and reads once per outage rather than per attempt", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = harness();
  let reads = 0;
  const connected: boolean[] = [];
  const stop = app.client.subscribe(
    "welcome",
    () => reads++,
    (value) => connected.push(value),
  );
  app.sockets[0].receive({ type: "ready" });
  for (const delay of [750, 1500, 3000, 6000, 12000, 22500, 22500]) {
    const count = app.sockets.length;
    app.sockets.at(-1)!.end();
    assert.equal(reads, 3);
    t.mock.timers.tick(delay - 1);
    assert.equal(app.sockets.length, count);
    t.mock.timers.tick(1);
    assert.equal(app.sockets.length, count + 1);
  }
  app.sockets.at(-1)!.receive({ type: "ready" });
  assert.equal(reads, 4);
  assert.equal(connected.at(-1), true);
  app.sockets.at(-1)!.end();
  assert.equal(reads, 5);
  const count = app.sockets.length;
  t.mock.timers.tick(750);
  assert.equal(
    app.sockets.length,
    count + 1,
    "a healthy connection resets backoff",
  );
  stop();
});

test("heartbeats keep a quiet connection alive without reading HTTP resources", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = harness();
  let reads = 0;
  const stop = app.client.subscribe(
    "uploads",
    () => reads++,
    () => {},
  );
  const socket = app.sockets[0];
  socket.receive({ type: "ready" });
  for (let index = 0; index < 6; index++) {
    t.mock.timers.tick(20000);
    socket.receive({ type: "heartbeat" });
  }
  assert.equal(socket.closes, 0);
  assert.equal(reads, 2);
  t.mock.timers.tick(59999);
  assert.equal(socket.closes, 0);
  t.mock.timers.tick(1);
  assert.equal(socket.closes, 1);
  assert.equal(reads, 3);
  t.mock.timers.tick(750);
  assert.equal(app.sockets.length, 2);
  stop();
});

test("visibility and connectivity changes resynchronize and release hidden sockets", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = harness();
  let reads = 0;
  const stop = app.client.subscribe(
    "programme",
    () => reads++,
    () => {},
  );
  app.sockets[0].receive({ type: "ready" });
  app.availability(false);
  assert.equal(app.sockets[0].closes, 1);
  t.mock.timers.tick(120000);
  assert.equal(app.sockets.length, 1);
  assert.equal(reads, 2);
  app.availability(true);
  assert.equal(app.sockets.length, 2);
  assert.equal(reads, 3, "returning checks the session even if upgrade fails");
  app.sockets[1].receive({ type: "ready" });
  assert.equal(reads, 4);
  app.client.retry();
  assert.equal(app.sockets.length, 2);
  stop();
});

test("session expiry redirects once and never reconnects or refreshes protected data", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = harness();
  let reads = 0;
  const stop = app.client.subscribe(
    "welcome",
    () => reads++,
    () => {},
  );
  app.sockets[0].receive({ type: "ready" });
  app.sockets[0].end(4401);
  app.client.retry();
  app.availability(false);
  app.availability(true);
  const stopLate = app.client.subscribe(
    "uploads",
    () => reads++,
    () => {},
  );
  t.mock.timers.tick(120000);
  assert.equal(app.sockets.length, 1);
  assert.equal(reads, 2);
  assert.equal(app.counts().expired, 1);
  stopLate();
  stop();
});

test("a stalled initial handshake retries without recurring HTTP requests", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = harness();
  let reads = 0;
  const connected: boolean[] = [];
  const stop = app.client.subscribe(
    "welcome",
    () => reads++,
    (value) => connected.push(value),
  );
  t.mock.timers.tick(10000);
  assert.equal(app.sockets[0].closes, 1);
  assert.deepEqual(connected, [false]);
  t.mock.timers.tick(750);
  assert.equal(app.sockets.length, 2);
  t.mock.timers.tick(10000);
  assert.equal(reads, 1);
  stop();
});
