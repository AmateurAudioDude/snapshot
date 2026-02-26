const SNAPSHOT_INTERVAL_HOURS = 6;
const SAFE_HEAP_THRESHOLD_MB = 250;

/*
 * === MEMORY LEAK / HIGH USAGE DEBUGGING INSTRUCTIONS ===
 * 
 * PURPOSE: Use heap snapshots to find which plugin or code is consuming too much memory
 *          (e.g. large arrays, caches, buffers not being cleared).
 * 
 * STEP 1: Enable this plugin and restart the app
 *         (recommended for systems with less than 4GB RAM).
 *         (Optional: on PCs with plenty of RAM, you can omit --max-old-space-size.)
 *         node --max-old-space-size=384 index.js  (or 448/512 if needed)
 * 
 * STEP 2: Monitor memory usage in console
 *         - Or use htop: sudo apt install htop   then htop --> find node process
 * 
 * STEP 3: Trigger a heap snapshot (safest method):
 *         When memory is reasonably low (<250 MB heap) or just before you expect a spike:
 *         1. Find the Node process PID:   ps aux | grep node
 *         2. Send signal:   kill -USR2 <PID>
 *            --> You should see "Heap snapshot written: /heap-........heapsnapshot"
 *         - Or use htop: select the process, press F9 and select SIGUSR2.
 *         - Do not select the wrong process, it will kill it.
 *
 *         If it fails (OOM or error), lower SAFE_HEAP_THRESHOLD_MB to 200 and retry.
 * 
 * STEP 4: Transfer the snapshot file to your computer if required (from another machine):
 * 
 * STEP 5: Analyze the .heapsnapshot file on your desktop/laptop with Chrome:
 * 
 *   1. Open Chrome browser
 *   2. Go to:   chrome://inspect   (or just type it in the address bar)
 *   3. Click "Open dedicated DevTools for Node" (or go directly to chrome://inspect/#devices)
 *   4. In DevTools --> switch to the **Memory** tab
 *   5. At the bottom-left: Click "Load" (or the + icon next to "Heap Snapshots")
 *   6. Select the transferred .heapsnapshot file
 * 
 *   Analysis steps inside Memory tab:
 * 
 *   A. Switch dropdown to **Summary** view
 *   B. In the "Class filter" box (top), type one of these and press Enter:
 *      - Array
 *      - Object
 *      - string
 *      - Buffer
 *      - ArrayBuffer
 *      - Map
 *      - Set
 *      - (compiled code)   ← sometimes shows file names
 *   C. Sort the list by **Retained Size** descending (click column header)
 *   D. Look at the top 5–10 largest entries (ignore anything <5–10 MB)
 *   E. Click one large item (e.g. huge Array or Object)
 *   F. In bottom pane --> switch to **Retainers** tab
 *   G. Expand the entire retainer tree (click all arrows)
 *      --> Look for lines containing:
 *        - /plugins/
 *        - plugins/
 *        - *_server.js   (or other app files)
 *        - (closure) @ filename.js:line
 *        - module @ /path/to/file.js
 *      --> The file name + line in the retainer chain is usually the code retaining the large object
 * 
 *   Common culprits:
 *   - Large Array/Map retained by closure in a plugin file --> unbounded cache/push
 *   - Many strings/Buffer --> accumulating logs or responses
 *   - Event listeners or timers not removed
 * 
 *   Pro tips:
 *   - Take 2–3 snapshots: one at startup (low mem), one mid-run, one when high --> compare them
 *     (select two in left sidebar --> right-click --> Compare --> look at Size Delta)
 *   - Search Ctrl+F (Cmd+F on Mac) for "plugins" or ".js" if visible
 * 
 *   Once you find a suspicious file/line --> open that .js file and look for:
 *   - Arrays/Maps/Sets without size limits or clearing
 *   - Global variables holding data
 *   - Event listeners without removeListener
 *   - Large file reads without streaming
 * 
 * Good luck.
 */
 
const v8 = require('v8');
const path = require('path');
const rootDir = path.dirname(require.main.filename);
const { logInfo, logWarn, logError } = require(rootDir + '/server/console');

function takeSnapshot() {
  const stats = v8.getHeapStatistics();
  const heapUsedMB = stats.used_heap_size / (1024 * 1024);

  logInfo(`[SNAPSHOT] Current heap used: ${heapUsedMB.toFixed(1)} MB`);

  if (heapUsedMB > SAFE_HEAP_THRESHOLD_MB) {
    logError(`Snapshot skipped: heap ${heapUsedMB.toFixed(1)} MB > safe ${SAFE_HEAP_THRESHOLD_MB} MB`);
    return;
  }

  const filename = `${rootDir}/heap-${Date.now()}.heapsnapshot`;

  try {
    v8.writeHeapSnapshot(filename);
    logInfo(`[SNAPSHOT] Snapshot written: ${filename} (used ${heapUsedMB.toFixed(1)} MB)`);
  } catch (err) {
    logError('[SNAPSHOT] Snapshot failed:', err.message);
  }
}

process.on('SIGUSR2', () => {
  logInfo('[SNAPSHOT] SIGUSR2 --> taking snapshot');
  takeSnapshot();
});

setInterval(() => {
  logInfo('[SNAPSHOT] Periodic snapshot check');
  takeSnapshot();
}, SNAPSHOT_INTERVAL_HOURS * 60 * 60 * 1000);

setInterval(() => {
  const u = process.memoryUsage();
  logInfo(`[SNAPSHOT] Heap used: ${(u.heapUsed/1024/1024).toFixed(1)} MB`);
}, 1 * 60 * 60 * 1000);

setTimeout(() => {
  logWarn('[SNAPSHOT] Snapshot is running - be sure to read all instructions in the file');
}, 60 * 1000);
