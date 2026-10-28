/* Runs the Python circuit engine (Pyodide + NumPy) off the main thread. */
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
importScripts(PYODIDE + "pyodide.js");

let py = null, api = null;
const post = (m) => self.postMessage(m);

async function boot(resValues) {
  post({ type: "progress", text: "Loading Python", pct: 5 });
  py = await loadPyodide({ indexURL: PYODIDE });
  post({ type: "progress", text: "Loading NumPy", pct: 30 });
  await py.loadPackage("numpy");
  post({ type: "progress", text: "Loading circuit engine", pct: 65 });
  const buf = await (await fetch("py/ecelab.zip")).arrayBuffer();
  py.unpackArchive(buf, "zip");
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
  post({ type: "progress", text: "Starting", pct: 85 });
  py.runPython("import os; os.environ['ECELAB_NO_NATIVE'] = '1'\nfrom ecelab import web_api");
  api = py.pyimport("ecelab.web_api");
  api.RES_VALUES = py.toPy(resValues);
  post({ type: "progress", text: "Ready", pct: 100 });
}

self.onmessage = async (e) => {
  const { id, fn, args } = e.data;
  try {
    if (fn === "boot") { await boot(args[0]); post({ id, ok: true, value: true }); return; }
    const out = api[fn](...args);
    post({ id, ok: true, value: out });
  } catch (err) {
    post({ id, ok: false, error: String(err && err.message || err) });
  }
};
