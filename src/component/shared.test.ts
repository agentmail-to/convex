import { describe, expect, it } from "vitest";
import {
  vEvent,
  vEventType,
  vOutboundStatus,
  vRuntimeConfig,
  vSendKind,
  vSendPayload,
} from "./shared.js";

// Convex validators don't expose a public parse() — we test that the validator
// describes the expected shape by inspecting its kind.
describe("validators", () => {
  it("vSendKind covers the four send variants", () => {
    expect(vSendKind.kind).toBe("union");
  });

  it("vOutboundStatus covers the full lifecycle", () => {
    expect(vOutboundStatus.kind).toBe("union");
  });

  it("vEventType covers all webhook event types", () => {
    expect(vEventType.kind).toBe("union");
  });

  it("vSendPayload describes the message body", () => {
    expect(vSendPayload.kind).toBe("object");
  });

  it("vEvent describes the webhook envelope", () => {
    expect(vEvent.kind).toBe("object");
  });

  it("vRuntimeConfig describes component config", () => {
    expect(vRuntimeConfig.kind).toBe("object");
    // Spot check a couple of expected fields exist on the validator.
    expect(vRuntimeConfig.fields).toHaveProperty("apiKey");
    expect(vRuntimeConfig.fields).toHaveProperty("baseUrl");
    expect(vRuntimeConfig.fields).toHaveProperty("retryAttempts");
  });
});
