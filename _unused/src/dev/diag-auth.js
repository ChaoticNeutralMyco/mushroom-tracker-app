/* Diagnostic script loaded by /public/auth-diag.html
 * Uses your app's firebase-config singleton and prints clear results.
 */
import { auth } from "../firebase-config";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
} from "firebase/auth";

// Read key flags so we know what the app *thinks* it's using.
const env = import.meta.env;
const host = "127.0.0.1";
const auPort = Number(env.VITE_EMULATOR_AUTH_PORT || 9099);
const fsPort = Number(env.VITE_EMULATOR_FIRESTORE_PORT || 8080);
const stPort = Number(env.VITE_EMULATOR_STORAGE_PORT || 9199);

const status = document.getElementById("status");
const out = document.getElementById("out");
const log = (m) => (out.textContent += `\n${m}`);

function banner() {
  const dev = env.DEV;
  // Try to infer whether connectAuthEmulator ran by checking internal field
  const emuHint =
    (auth.config && auth.config.apiHost && auth.config.apiHost.includes(`${host}:${auPort}`)) ||
    (auth._getApp && typeof auth._getApp === "function"); // weak hint
  status.innerHTML = `
    <div>
      <span class="tag">DEV: ${dev ? "yes" : "no"}</span>
      <span class="tag">AUTH emulator target: http://${host}:${auPort}</span>
      <span class="tag">FS: ${fsPort}</span>
      <span class="tag">ST: ${stPort}</span>
    </div>
    <div class="muted" style="margin-top:8px">
      If you don't see a green console banner from <code>firebase-config.js</code> on app load,
      Vite didn't restart or another file is being used.
    </div>
  `;
}
banner();

// Wire buttons
document.getElementById("btnPing").onclick = async () => {
  out.textContent = "Pinging...";
  try {
    const url = `http://${host}:${auPort}/emulator/v1/projects/${env.VITE_FIREBASE_PROJECT_ID || "chaotic-neutral-tracker"}/config`;
    const r = await fetch(url, { mode: "cors" });
    log(`Ping ${url} => HTTP ${r.status}`);
    const text = await r.text();
    log(text.slice(0, 200) + (text.length > 200 ? "…" : ""));
  } catch (e) {
    log("Ping failed: " + (e?.message || e));
  }
};

document.getElementById("btnAnon").onclick = async () => {
  out.textContent = "Trying anonymous sign-in…";
  try {
    const cred = await signInAnonymously(auth);
    log("OK anon => uid=" + cred.user.uid);
  } catch (e) {
    log("Anon failed: " + (e.code || e.message || e));
  }
};

document.getElementById("btnSignup").onclick = async () => {
  out.textContent = "Creating user…";
  const email = document.getElementById("email").value;
  const pass = document.getElementById("pass").value;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    log("Created user uid=" + cred.user.uid);
  } catch (e) {
    log("Create failed: " + (e.code || e.message || e));
  }
};

document.getElementById("btnSignin").onclick = async () => {
  out.textContent = "Signing in…";
  const email = document.getElementById("email").value;
  const pass = document.getElementById("pass").value;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    log("OK signin => uid=" + cred.user.uid);
  } catch (e) {
    log("Sign-in failed: " + (e.code || e.message || e));
  }
};
