import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (b: string | Uint8Array) => createHash("sha256").update(b).digest();

/**
 * Passkey en logiciel, avec de vraies signatures : le serveur la vérifie comme une vraie. `uv` dit si l'appareil a
 * vérifié la personne. Elle ne dit rien du comportement des navigateurs et des appareils réels.
 */
export class FausseCle {
  readonly id = randomBytes(16).toString("base64url");
  private keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  private compteur = 0;

  constructor(
    private origin: string,
    private rpID = new URL(origin).hostname,
  ) {}

  private clientData(type: string, challenge: string): string {
    return JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false });
  }

  private authData(flags: number, suite: Uint8Array = new Uint8Array()): Buffer {
    const compteur = Buffer.alloc(4);
    compteur.writeUInt32BE(this.compteur);
    return Buffer.concat([sha256(this.rpID), Buffer.from([flags]), compteur, suite]);
  }

  /** Réponse à `startRegistration`. */
  creation(challenge: string, uv = true): RegistrationResponseJSON {
    const { x, y } = this.keys.publicKey.export({ format: "jwk" });
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(x!, "base64url")],
        [-3, Buffer.from(y!, "base64url")],
      ]),
    );
    const id = Buffer.from(this.id, "base64url");
    const longueur = Buffer.alloc(2);
    longueur.writeUInt16BE(id.length);
    const authData = this.authData(UP | AT | (uv ? UV : 0), Buffer.concat([Buffer.alloc(16), longueur, id, cose]));
    const attestation = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, string>>([
        ["fmt", "none"],
        ["attStmt", new Map<string, string>()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: Buffer.from(this.clientData("webauthn.create", challenge)).toString("base64url"),
        attestationObject: b64(attestation),
        transports: ["internal"],
      },
    };
  }

  /** Réponse à `startAuthentication`. */
  entree(challenge: string, uv = true): AuthenticationResponseJSON {
    this.compteur++;
    const authData = this.authData(UP | (uv ? UV : 0));
    const clientData = this.clientData("webauthn.get", challenge);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientData)]), this.keys.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        authenticatorData: b64(authData),
        clientDataJSON: Buffer.from(clientData).toString("base64url"),
        signature: b64(signature),
      },
    };
  }
}
