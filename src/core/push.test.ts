import { describe, it, expect, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";
import {
  PUSH_APP_ID,
  gatewayUrlForEndpoint,
  registerUnifiedPushPusher,
  removeUnifiedPushPushers,
  hasUnifiedPushPusher,
} from "./push";

describe("gatewayUrlForEndpoint", () => {
  it("derives the ntfy Matrix gateway from a public ntfy.sh endpoint", () => {
    expect(gatewayUrlForEndpoint("https://ntfy.sh/UPabc123?up=1")).toBe(
      "https://ntfy.sh/_matrix/push/v1/notify",
    );
  });

  it("derives from a self-hosted endpoint incl. custom port, ignoring path/query", () => {
    expect(gatewayUrlForEndpoint("https://push.example.org:8443/UPxyz?up=1")).toBe(
      "https://push.example.org:8443/_matrix/push/v1/notify",
    );
  });
});

describe("registerUnifiedPushPusher", () => {
  it("registers an event_id_only http pusher with the derived gateway", async () => {
    const setPusher = vi.fn().mockResolvedValue({});
    const client = { setPusher } as unknown as MatrixClient;
    await registerUnifiedPushPusher(client, {
      endpoint: "https://ntfy.sh/UPabc123?up=1",
      deviceDisplayName: "Materix · Pixel",
    });
    expect(setPusher).toHaveBeenCalledWith({
      kind: "http",
      app_id: PUSH_APP_ID,
      pushkey: "https://ntfy.sh/UPabc123?up=1",
      app_display_name: "Materix",
      device_display_name: "Materix · Pixel",
      lang: "en",
      data: { url: "https://ntfy.sh/_matrix/push/v1/notify", format: "event_id_only" },
      append: false,
    });
  });

  it("honors a gateway override for split push-gateway setups", async () => {
    const setPusher = vi.fn().mockResolvedValue({});
    const client = { setPusher } as unknown as MatrixClient;
    await registerUnifiedPushPusher(client, {
      endpoint: "https://ntfy.sh/UPabc123?up=1",
      gatewayUrl: "https://sygnal.example.org/_matrix/push/v1/notify",
      deviceDisplayName: "Materix",
    });
    expect(setPusher.mock.calls[0][0].data.url).toBe(
      "https://sygnal.example.org/_matrix/push/v1/notify",
    );
  });
});

describe("removeUnifiedPushPushers", () => {
  it("removes only our own pushers, leaving other clients' untouched", async () => {
    const getPushers = vi.fn().mockResolvedValue({
      pushers: [
        { app_id: PUSH_APP_ID, pushkey: "https://ntfy.sh/UPa?up=1" },
        { app_id: "im.vector.app.android", pushkey: "someFcmToken" },
        { app_id: PUSH_APP_ID, pushkey: "https://ntfy.sh/UPb?up=1" },
      ],
    });
    const removePusher = vi.fn().mockResolvedValue({});
    const client = { getPushers, removePusher } as unknown as MatrixClient;
    await removeUnifiedPushPushers(client);
    expect(removePusher).toHaveBeenCalledTimes(2);
    expect(removePusher).toHaveBeenCalledWith("https://ntfy.sh/UPa?up=1", PUSH_APP_ID);
    expect(removePusher).toHaveBeenCalledWith("https://ntfy.sh/UPb?up=1", PUSH_APP_ID);
  });
});

describe("hasUnifiedPushPusher", () => {
  it("matches on our app_id + the exact endpoint", async () => {
    const getPushers = vi.fn().mockResolvedValue({
      pushers: [{ app_id: PUSH_APP_ID, pushkey: "https://ntfy.sh/UPa?up=1" }],
    });
    const client = { getPushers } as unknown as MatrixClient;
    expect(await hasUnifiedPushPusher(client, "https://ntfy.sh/UPa?up=1")).toBe(true);
    expect(await hasUnifiedPushPusher(client, "https://ntfy.sh/UPother?up=1")).toBe(false);
  });
});
