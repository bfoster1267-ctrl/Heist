// Prints a fresh VAPID key pair for phone turn alerts. Put both in the server's environment
// (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY), never in the repo. Changing them later signs every phone out of alerts.
import { makeVapidKeys } from "../src/push";

const k = makeVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
