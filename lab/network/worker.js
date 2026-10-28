/* Runs the Python network engine (Pyodide) off the main thread. */
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
importScripts(PYODIDE + "pyodide.js");

let api = null;
const post = (m) => self.postMessage(m);

async function boot() {
  post({ type: "progress", text: "Loading Python", pct: 10 });
  const py = await loadPyodide({ indexURL: PYODIDE });
  post({ type: "progress", text: "Loading the network engine", pct: 55 });
  py.unpackArchive(await (await fetch("../py/ecelab-net.zip")).arrayBuffer(), "zip");
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
  post({ type: "progress", text: "Starting", pct: 90 });
  api = py.pyimport("ecelab.netweb_api");
  post({ type: "progress", text: "Ready", pct: 100 });
}

self.onmessage = async (e) => {
  const { id, fn, args } = e.data;
  try {
    if (fn === "boot") { await boot(); post({ id, ok: true, value: true }); return; }
    post({ id, ok: true, value: api[fn](...args) });
  } catch (err) { post({ id, ok: false, error: String((err && err.message) || err) }); }
};
