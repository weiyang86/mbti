import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { PrismaService } from "../prisma/prisma.service";
import { SecretRefPort } from "../secret-center/secret-ref";
import { requireConnectorManifest } from "./connector-manifest";
import { validateWebhookSignatureInput, verifyWebhookSignature } from "./connector-webhook-signature";

type WebhookRequest = Readonly<{ rawBody?: Buffer; headers: IncomingHttpHeaders }>;
type InstallationSnapshot = Readonly<{ id: string; projectId: string; connectorCode: string; secretRef: string; status: string; scopes: string[]; version: number }>;

@Injectable()
export class ConnectorWebhookService {
  private readonly environment: string;

  constructor(private readonly prisma: PrismaService, private readonly secrets: SecretRefPort, runtime: ConfigService) {
    this.environment = runtime.getOrThrow<string>("environment");
  }

  private async installation(projectCode: string, connectorCode: string): Promise<InstallationSnapshot> {
    const manifest = requireConnectorManifest(connectorCode);
    if (manifest.protocol !== "webhook" || !manifest.scopes.includes("webhook:receive")) throw new NotFoundException("Webhook connector unavailable");
    const project = await this.prisma.projectProfile.findFirst({
      where: { code: projectCode, deletedAt: null, organization: { deletedAt: null } },
      select: { id: true, environment: true, status: true, organization: { select: { status: true } } }
    });
    if (!project || project.environment !== this.environment || project.status !== "active" || project.organization.status !== "active") {
      throw new NotFoundException("Webhook connector unavailable");
    }
    const row = await this.prisma.connectorInstallation.findUnique({
      where: { projectId_connectorCode: { projectId: project.id, connectorCode } },
      select: { id: true, projectId: true, connectorCode: true, secretRef: true, status: true, scopes: true, version: true, deletedAt: true }
    });
    if (!row || row.deletedAt || !["configured", "enabled"].includes(row.status) || !row.scopes.includes("webhook:receive")) {
      throw new NotFoundException("Webhook connector unavailable");
    }
    return { id: row.id, projectId: row.projectId, connectorCode: row.connectorCode, secretRef: row.secretRef, status: row.status, scopes: row.scopes, version: row.version };
  }

  async receive(projectCode: string, connectorCode: string, request: WebhookRequest) {
    const contentType = request.headers["content-type"];
    if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) throw new BadRequestException("Webhook content type must be application/json");
    if (!Buffer.isBuffer(request.rawBody) || request.rawBody.length < 1 || request.rawBody.length > 65_536) throw new BadRequestException("Invalid webhook body size");
    const signatureHeaders = {
      timestamp: request.headers["x-aij-webhook-timestamp"],
      idempotencyKey: request.headers["x-aij-webhook-idempotency-key"],
      signature: request.headers["x-aij-webhook-signature"]
    };
    const normalizedHeaders = {
      timestamp: Array.isArray(signatureHeaders.timestamp) ? undefined : signatureHeaders.timestamp,
      idempotencyKey: Array.isArray(signatureHeaders.idempotencyKey) ? undefined : signatureHeaders.idempotencyKey,
      signature: Array.isArray(signatureHeaders.signature) ? undefined : signatureHeaders.signature
    };
    validateWebhookSignatureInput(request.rawBody, normalizedHeaders, { projectCode, connectorCode });
    const snapshot = await this.installation(projectCode, connectorCode);
    // Resolve a fresh SecretRef on every request; the value never leaves this service.
    const secret = await this.secrets.resolveTrusted(snapshot.secretRef);
    const verified = verifyWebhookSignature(request.rawBody, normalizedHeaders, secret, { projectCode, connectorCode });
    let payload: unknown;
    try { payload = JSON.parse(request.rawBody!.toString("utf8")); }
    catch { throw new BadRequestException("Webhook body must be valid JSON"); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new BadRequestException("Webhook body must be a JSON object");
    const payloadSha256 = createHash("sha256").update(request.rawBody!).digest("hex");
    const eventTimestamp = new Date(verified.timestampSeconds * 1000);

    try {
      return await this.prisma.$transaction(async tx => {
        const current = await tx.connectorInstallation.findUnique({
          where: { id: snapshot.id },
          select: { projectId: true, connectorCode: true, secretRef: true, status: true, scopes: true, version: true, deletedAt: true,
            project: { select: { code: true, environment: true, status: true, deletedAt: true, organization: { select: { status: true, deletedAt: true } } } } }
        });
        if (!current || current.deletedAt || current.project.code !== projectCode || current.project.environment !== this.environment ||
            current.project.status !== "active" || current.project.deletedAt || current.project.organization.status !== "active" ||
            current.project.organization.deletedAt || current.secretRef !== snapshot.secretRef || current.version !== snapshot.version ||
            !["configured", "enabled"].includes(current.status) || !current.scopes.includes("webhook:receive")) {
          throw new NotFoundException("Webhook connector unavailable");
        }
        const secretReference = await tx.secretReference.findFirst({ where: { ref: snapshot.secretRef, status: "active", deletedAt: null }, select: { id: true } });
        if (!secretReference) throw new NotFoundException("Webhook connector unavailable");
        const inserted = await tx.connectorInboundEvent.createMany({
          data: [{ projectId: current.projectId, connectorCode: current.connectorCode, idempotencyKey: verified.idempotencyKey,
            payloadSha256, eventTimestamp, installationVersion: current.version }],
          skipDuplicates: true
        });
        const event = await tx.connectorInboundEvent.findUnique({
          where: { projectId_connectorCode_idempotencyKey: { projectId: current.projectId, connectorCode: current.connectorCode, idempotencyKey: verified.idempotencyKey } },
          select: { id: true, payloadSha256: true, eventTimestamp: true, receivedAt: true }
        });
        if (!event) throw new ConflictException("Webhook idempotency record unavailable");
        if (event.payloadSha256 !== payloadSha256) throw new ConflictException("Webhook idempotency key was already used with another payload");
        return { accepted: true, duplicate: inserted.count === 0, eventId: event.id, receivedAt: event.receivedAt };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new ConflictException("Webhook state changed; retry with the same idempotency key");
      throw error;
    }
  }
}
