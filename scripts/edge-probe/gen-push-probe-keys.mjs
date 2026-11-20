/**
 * Print throwaway APNs (ES256) and FCM service-account (RS256) credentials as
 * dotenv lines for scripts/test-edge-push.sh.
 *
 * send-push signs a REAL provider JWT with jose before it will call either vendor,
 * so the probe needs real keys — but never Apple's or Google's. These are generated
 * fresh on every run, live only in a mktemp env file the runner deletes, and are
 * accepted by a stub that does not verify them. Nothing here is a secret, and
 * nothing here is checked in: a committed test key is a key someone will eventually
 * paste into a real config.
 *
 * Values are SINGLE-QUOTED with literal \n escapes rather than real newlines,
 * because an env file is line-oriented. send-push's own normalizePrivateKeyPem()
 * (and JSON.parse, for the service account) turns them back into newlines — the
 * same shape the deployed secrets have.
 */
import { generateKeyPairSync } from "node:crypto";

const oneLine = (pem) => pem.trim().replace(/\n/g, "\\n");

const { privateKey: ecKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const apnsPem = ecKey.export({ type: "pkcs8", format: "pem" });

const { privateKey: rsaKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const fcmPem = rsaKey.export({ type: "pkcs8", format: "pem" });

const serviceAccount = {
  type: "service_account",
  project_id: "dcpush-probe",
  private_key_id: "dcpush-probe-key",
  private_key: `${fcmPem.trim()}\n`,
  client_email: "dcpush-probe@dcpush-probe.iam.gserviceaccount.com",
  client_id: "000000000000000000000",
  token_uri: "https://oauth2.googleapis.com/token",
};

process.stdout.write(`APNS_PRIVATE_KEY='${oneLine(apnsPem)}'\n`);
// JSON.stringify already escapes the PEM newlines as \n inside the string, so the
// whole document is one line; single-quoting keeps godotenv from touching it.
process.stdout.write(`FCM_SERVICE_ACCOUNT_JSON='${JSON.stringify(serviceAccount)}'\n`);
