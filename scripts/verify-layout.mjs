// Renders playground demos in headless Chrome, saves screenshots and checks layout rules that unit tests
// can't see (jsdom/happy-dom don't do layout). Usage: pnpm verify:layout [demo-id[:option] ...]
// With `:option`, the demo's select that has that option is switched to it first (e.g. `task-list:big`).
// Chrome: set CHROME_PATH, or it is looked up in the usual install locations.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '.layout');
const DEMOS =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['bars', 'scheduling', 'task-list', 'task-list:big', 'timeaxis'];
// Headless Chrome on macOS has overlay scrollbars (no room taken); the classic pass styles scrollbars so they
// take room, like on Windows or with a mouse on macOS.
const VARIANTS = [{ width: 1400 }, { width: 700 }, { width: 700, classic: true }];
const CLASSIC_SCROLLBARS = `(() => {
  const style = document.createElement('style');
  style.textContent = '::-webkit-scrollbar { width: 14px; height: 14px; background: #eee } ::-webkit-scrollbar-thumb { background: #aaa }';
  document.head.append(style);
})()`;
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
  const list = document.querySelector('.qz-list__body');
  const gantt = document.querySelector('.qz-gantt');
  if (list && gantt && list.scrollWidth > list.clientWidth) {
    const max = getComputedStyle(gantt).getPropertyValue('--qz-list-max-width').trim() || '60%';
    const maxWidth = max.endsWith('%') ? (gantt.clientWidth * parseFloat(max)) / 100 : parseFloat(max);
    if (list.getBoundingClientRect().width < maxWidth - 1) {
      problems.push('task list scrolls horizontally although it is narrower than its max width');
    }
  }
  const timelineHeader = document.querySelector('.qz-timeline__header');
  const scroller = document.querySelector('.qz-gantt__scroller');
  const listHeader = document.querySelector('.qz-list__header');
  const listBody = document.querySelector('.qz-list__body');
  const body = document.querySelector('.qz-timeline__body');
  // The rows start right below the headers, at the same height on both sides.
  for (const [rows, head, name] of [[listBody, listHeader, 'task list'], [body, timelineHeader, 'timeline']]) {
    if (!rows || !head) continue;
    const gap = rows.getBoundingClientRect().top - head.getBoundingClientRect().bottom;
    if (Math.abs(gap) > 0.5) problems.push(name + ' rows start ' + gap + 'px from the header');
  }
  // The task list is equally wide in the header, the rows and the footer.
  const paneWidths = ['.qz-list__header', '.qz-list__body', '.qz-list__scrollbar']
    .map((selector) => document.querySelector(selector))
    .filter((element) => element && element.offsetParent)
    .map(width);
  if (paneWidths.some((paneWidth) => Math.abs(paneWidth - paneWidths[0]) > 0.5)) {
    problems.push('task list widths differ between header, rows and footer: ' + JSON.stringify(paneWidths));
  }
  if (timelineHeader && body && Math.abs(width(timelineHeader) - width(body)) > 0.5) {
    problems.push('timeline header and rows differ in width: ' + width(timelineHeader) + ' vs ' + width(body));
  }
  // Bars beyond the axis must not widen the scroll area.
  if (scroller && listHeader && body) {
    const contentWidth = Math.max(width(listHeader) + width(body), scroller.clientWidth);
    if (scroller.scrollWidth > contentWidth + 1) {
      problems.push('scrolls ' + (scroller.scrollWidth - contentWidth) + 'px beyond the axis');
    }
  }
  // The separate scrollbars scroll exactly as far as the content.
  const range = (element, axis) =>
    axis === 'x' ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
  for (const [selector, axis, content] of [
    ['.qz-timeline__scrollbar', 'x', scroller],
    ['.qz-gantt__scrollbar-y', 'y', scroller],
    ['.qz-list__scrollbar', 'x', listBody],
  ]) {
    const bar = document.querySelector(selector);
    if (!bar || !content || !bar.offsetParent) continue;
    if (Math.abs(range(bar, axis) - range(content, axis)) > 1) {
      problems.push(selector + ' scrolls ' + range(bar, axis) + 'px, the content ' + range(content, axis) + 'px');
    }
  }
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
    problems.push('the page scrolls horizontally');
  }
  // Every timeline row sits at the same height as its task list row, and its bar stays inside the row.
  const listRows = new Map([...document.querySelectorAll('.qz-grid__row')].map((row) => [row.dataset.key, row]));
  const listBottom = listBody ? listBody.getBoundingClientRect().bottom : Infinity;
  const timelineRows = [...document.querySelectorAll('.qz-timeline__row')];
  if (listRows.size > 0 && timelineRows.length === 0) problems.push('the timeline has no rows');
  for (const row of timelineRows) {
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top > listBottom) continue; // rendered ahead but scrolled out of view
    const listRow = listRows.get(row.dataset.key);
    if (!listRow) {
      problems.push('timeline row ' + row.dataset.key + ' has no task list row');
      break;
    }
    if (Math.abs(listRow.getBoundingClientRect().top - rowRect.top) > 0.5) {
      problems.push('timeline row ' + row.dataset.key + ' is not aligned with its task list row');
      break;
    }
    const bar = row.querySelector('.qz-bar');
    if (bar) {
      const barRect = bar.getBoundingClientRect();
      if (barRect.top < rowRect.top - 0.5 || barRect.bottom > rowRect.bottom + 0.5) {
        problems.push('bar of row ' + row.dataset.key + ' sticks out of its row');
        break;
      }
    }
  }
  // In the bars demo (automatically scheduled, day ticks, office hours 08:00–16:00), every visible bar starts at
  // 00:00, 08:00 or 16:00 of a day: checks bar positions against the header. (Not the scheduling demo: its manual
  // task starts at 12:00.)
  if (location.hash === '#bars' && scroller) {
    const view = scroller.getBoundingClientRect();
    const ticks = [...document.querySelectorAll('.qz-header__row:last-child .qz-header__cell')].flatMap((cell) => {
      const { left, width } = cell.getBoundingClientRect();
      return [left, left + width / 3, left + (2 * width) / 3];
    });
    const bars = [...document.querySelectorAll('.qz-bar')];
    if (bars.length === 0) problems.push('the demo shows no bars');
    for (const bar of bars) {
      const rect = bar.getBoundingClientRect();
      // A milestone's left edge is the center of its diamond.
      const x = bar.classList.contains('qz-bar--milestone') ? rect.left + rect.width / 2 : rect.left;
      if (x < view.left || x > view.right || rect.top > view.bottom) continue;
      if (!ticks.some((tick) => Math.abs(tick - x) <= 1)) {
        problems.push('bar "' + bar.title + '" does not start at 00:00, 08:00 or 16:00 (x = ' + x + ')');
        break;
      }
    }
  }
  // Both sides scroll vertically as one: right after a scroll, before any scroll event has run, rows still line
  // up. (Syncing a second scroll area from scroll events lags a frame behind the compositor, visible as jitter.)
  const vertical = scroller;
  if (vertical && vertical.scrollHeight > vertical.clientHeight + 1) {
    vertical.scrollTop = Math.min(500, vertical.scrollHeight - vertical.clientHeight);
    const view = vertical.getBoundingClientRect();
    const listRows = new Map([...document.querySelectorAll('.qz-grid__row')].map((row) => [row.dataset.key, row]));
    let compared = 0;
    for (const row of document.querySelectorAll('.qz-timeline__row')) {
      const top = row.getBoundingClientRect().top;
      const listRow = listRows.get(row.dataset.key);
      if (!listRow || top < view.top || top > view.bottom) continue;
      compared++;
      if (Math.abs(listRow.getBoundingClientRect().top - top) > 0.5) {
        problems.push('after scrolling, task list and timeline rows are ' + (listRow.getBoundingClientRect().top - top) + 'px apart until the next scroll event');
        break;
      }
    }
    if (compared === 0) problems.push('no rows in view after scrolling');
  }
  return problems;
})()`;

// Horizontal scrolling: right after a scroll, before any scroll event has run, the timeline header still lines
// up with the rows (a header synced from scroll events lags a frame behind, visible as flicker). The footer
// scrollbar follows (on the scroll event), and dragging it moves the timeline.
const HORIZONTAL_CHECKS = `(async () => {
  const problems = [];
  const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const horizontal = document.querySelector('.qz-gantt__scroller');
  const headerCanvas = document.querySelector('.qz-timeline__header-canvas');
  const body = document.querySelector('.qz-timeline__body');
  const scrollbar = document.querySelector('.qz-timeline__scrollbar');
  if (!horizontal || horizontal.scrollWidth <= horizontal.clientWidth + 1) return problems;
  if (!scrollbar) return ['the timeline scrolls horizontally but there is no scrollbar'];
  const target = Math.min(300, horizontal.scrollWidth - horizontal.clientWidth);
  horizontal.scrollLeft = target;
  const offset = headerCanvas.getBoundingClientRect().left - body.getBoundingClientRect().left;
  if (Math.abs(offset) > 0.5) problems.push('after scrolling, the timeline header is ' + offset + 'px off the rows until the next scroll event');
  await frame();
  if (Math.abs(scrollbar.scrollLeft - target) > 1) problems.push('footer scrollbar did not follow the timeline (' + scrollbar.scrollLeft + ')');
  scrollbar.scrollLeft = target / 2;
  await frame();
  if (Math.abs(horizontal.scrollLeft - target / 2) > 1) problems.push('the footer scrollbar does not move the timeline (' + horizontal.scrollLeft + ')');
  horizontal.scrollLeft = 0;
  await frame();
  return problems;
})()`;

// Switches the demo's select that has the given option (React listens for the native change event).
const selectOption = (value) => `(() => {
  const select = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === ${JSON.stringify(value)}));
  if (!select) return false;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)});
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

// The mouse wheel over the timeline rows and over the task list scrolls vertically (the task list's own
// horizontal scroll area must pass vertical scrolling on).
async function wheelChecks(send) {
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
  const problems = [];
  for (const target of ['.qz-list__body', '.qz-timeline__body']) {
    const box = await evaluate(`(() => {
      const scroller = document.querySelector('.qz-gantt__scroller');
      if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) return null;
      scroller.scrollTop = 0;
      const view = scroller.getBoundingClientRect();
      const rect = document.querySelector('${target}').getBoundingClientRect();
      return { x: rect.left + Math.min(rect.width, view.right - rect.left) / 2, y: (rect.top + view.bottom) / 2 };
    })()`);
    if (!box) return problems;
    // Move there first: Chrome sends a wheel to what the pointer is over, which it only knows after a move.
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await sleep(100);
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: box.x,
      y: box.y,
      deltaX: 0,
      deltaY: 200,
    });
    await sleep(500);
    const scrollTop = await evaluate(`document.querySelector('.qz-gantt__scroller').scrollTop`);
    await evaluate(`document.querySelector('.qz-gantt__scroller').scrollTop = 0`);
    if (!(scrollTop > 0)) problems.push('the mouse wheel over ' + target + ' does not scroll the rows');
  }
  return problems;
}

// Scroll gestures (touch, like a trackpad: the browser scrolls on its own thread, and scroll events arrive a
// frame late): our scroll syncing must never move the content itself. Syncing a scrollbar's stale position
// back pulled the content back a step on every frame (flicker).
async function gestureChecks(send) {
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
  const problems = [];
  for (const [axis, xDistance, yDistance] of [
    ['scrollLeft', -800, 0],
    ['scrollTop', 0, -400],
  ]) {
    const box = await evaluate(`(() => {
      const scroller = document.querySelector('.qz-gantt__scroller');
      const range = '${axis}' === 'scrollLeft' ? scroller.scrollWidth - scroller.clientWidth : scroller.scrollHeight - scroller.clientHeight;
      if (range < 50) return null;
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
      window.__qzMoves = 0;
      const own = Object.getOwnPropertyDescriptor(Element.prototype, '${axis}');
      Object.defineProperty(scroller, '${axis}', {
        configurable: true,
        get() { return own.get.call(this); },
        set(value) { window.__qzMoves++; own.set.call(this, value); },
      });
      const rect = document.querySelector('.qz-timeline__body').getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      return { x: rect.left + 100, y: (rect.top + Math.min(rect.bottom, view.bottom)) / 2 };
    })()`);
    if (!box) continue;
    await sleep(200);
    await send('Input.synthesizeScrollGesture', {
      ...box,
      xDistance,
      yDistance,
      speed: 1500,
      gestureSourceType: 'touch',
    });
    await sleep(300);
    const moves = await evaluate(`(() => {
      const scroller = document.querySelector('.qz-gantt__scroller');
      delete scroller.${axis};
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
      return window.__qzMoves;
    })()`);
    if (moves > 0)
      problems.push(`scroll syncing moved the content ${String(moves)} times during a ${axis} gesture`);
  }
  return problems;
}

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
    for (const { width: viewportWidth, classic } of VARIANTS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: viewportWidth,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const [id, option] = demo.split(':');
      // Via a blank page: navigating to the same URL with only the hash changed wouldn't reload the demo.
      await send('Page.navigate', { url: 'about:blank' });
      await send('Page.navigate', { url: `http://localhost:${String(PORT)}/#${id}` });
      await sleep(300);
      if (classic) await send('Runtime.evaluate', { expression: CLASSIC_SCROLLBARS });
      await sleep(2000);
      if (option) {
        const selected = await send('Runtime.evaluate', {
          expression: selectOption(option),
          returnByValue: true,
        });
        if (!selected.result?.result?.value) console.log(`         - no select with option "${option}"`);
        await sleep(1000);
      }
      const result = await send('Runtime.evaluate', { expression: CHECKS, returnByValue: true });
      const problems = result.result?.result?.value ?? [
        `could not evaluate checks: ${String(result.result?.exceptionDetails?.exception?.description)}`,
      ];
      const horizontal = await send('Runtime.evaluate', {
        expression: HORIZONTAL_CHECKS,
        awaitPromise: true,
        returnByValue: true,
      });
      problems.push(...(horizontal.result?.result?.value ?? ['could not evaluate horizontal checks']));
      problems.push(...(await wheelChecks(send)));
      problems.push(...(await gestureChecks(send)));
      const label = `${demo.replace(':', '-')}-${String(viewportWidth)}${classic ? '-classic' : ''}`;
      const file = join(OUT, `${label}.png`);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
      const status = problems.length === 0 ? 'ok' : 'PROBLEMS';
      console.log(
        `${status.padEnd(8)} ${demo} @ ${String(viewportWidth)}px${classic ? ' (classic scrollbars)' : ''} → ${file}`,
      );
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
