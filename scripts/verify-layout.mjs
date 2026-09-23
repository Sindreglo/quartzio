// Renders playground demos in headless Chrome, saves screenshots and checks layout rules that unit tests
// can't see (jsdom/happy-dom don't do layout). Usage: pnpm verify:layout [demo-id ...]
// Chrome: set CHROME_PATH, or it is looked up in the usual install locations.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '.layout');
const DEMOS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['task-list', 'timeaxis'];
const WIDTHS = [1400, 700];
const PORT = 5299;
const DEBUG_PORT = 9399;

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((path) => path && existsSync(path));
if (!chromePath) {
  console.error('Chrome not found. Set CHROME_PATH.');
  process.exit(1);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Layout checks, evaluated in the page. Each returns a list of problems (empty = fine).
const CHECKS = `(() => {
  const problems = [];
  const width = (element) => Math.round(element.getBoundingClientRect().width * 10) / 10;
  const header = [...document.querySelectorAll('.qz-grid__header-cell')].map(width);
  for (const row of [...document.querySelectorAll('.qz-grid__row')].slice(0, 20)) {
    const cells = [...row.querySelectorAll('.qz-grid__cell')].map(width);
    if (cells.some((cell, i) => Math.abs(cell - header[i]) > 0.5)) {
      problems.push('cell widths ' + JSON.stringify(cells) + ' differ from header ' + JSON.stringify(header));
      break;
    }
  }
  // The task list may only scroll horizontally when it is capped at its max width (default 60%).
  const list = document.querySelector('.qz-list');
  const gantt = document.querySelector('.qz-gantt');
  if (list && gantt && list.scrollWidth > list.clientWidth) {
    const max = getComputedStyle(gantt).getPropertyValue('--qz-list-max-width').trim() || '60%';
    const maxWidth = max.endsWith('%') ? (gantt.clientWidth * parseFloat(max)) / 100 : parseFloat(max);
    if (list.getBoundingClientRect().width < maxWidth - 1) {
      problems.push('task list scrolls horizontally although it is narrower than its max width');
    }
  }
  const timelineHeader = document.querySelector('.qz-timeline__header');
  const scroller = document.querySelector('.qz-timeline__scroller');
  if (timelineHeader && scroller) {
    const gap = scroller.getBoundingClientRect().top - timelineHeader.getBoundingClientRect().bottom;
    if (Math.abs(gap) > 0.5) problems.push('timeline body starts ' + gap + 'px from the header');
  }
  const listBody = document.querySelector('.qz-list__body');
  if (listBody && scroller && Math.abs(listBody.getBoundingClientRect().top - scroller.getBoundingClientRect().top) > 0.5) {
    problems.push('task list body and timeline body do not start at the same height');
  }
  return problems;
})()`;

const server = await createServer({
  root: join(ROOT, 'apps/playground-react'),
  configFile: join(ROOT, 'apps/playground-react/vite.config.ts'),
  server: { port: PORT, strictPort: true },
  logLevel: 'error',
});
await server.listen();

const profile = join(tmpdir(), `quartzio-layout-${String(process.pid)}`);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${String(DEBUG_PORT)}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let exitCode = 0;
try {
  let targets;
  for (let attempt = 0; attempt < 50 && !targets; attempt++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${String(DEBUG_PORT)}/json`)).json();
    } catch {
      await sleep(200);
    }
  }
  const socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((done) => socket.addEventListener('open', done));
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
  });
  const send = (method, params = {}) =>
    new Promise((done) => {
      const id = ++nextId;
      pending.set(id, done);
      socket.send(JSON.stringify({ id, method, params }));
    });

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  for (const demo of DEMOS) {
    for (const viewportWidth of WIDTHS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: viewportWidth,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send('Page.navigate', { url: `http://localhost:${String(PORT)}/#${demo}` });
      await sleep(2000);
      const result = await send('Runtime.evaluate', { expression: CHECKS, returnByValue: true });
      const problems = result.result?.result?.value ?? ['could not evaluate checks'];
      const file = join(OUT, `${demo}-${String(viewportWidth)}.png`);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
      const status = problems.length === 0 ? 'ok' : 'PROBLEMS';
      console.log(`${status.padEnd(8)} ${demo} @ ${String(viewportWidth)}px → ${file}`);
      for (const problem of problems) console.log(`         - ${problem}`);
      if (problems.length > 0) exitCode = 1;
    }
  }
  socket.close();
} finally {
  // Wait for Chrome to exit before removing its profile; it keeps writing to it while shutting down.
  const exited = new Promise((done) => chrome.once('exit', done));
  chrome.kill();
  await Promise.race([exited, sleep(5000)]);
  await server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(exitCode);
