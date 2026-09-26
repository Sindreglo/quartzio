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
    : [
        'bars',
        'scheduling',
        'dependencies',
        'dependencies:hierarchy',
        'dependencies:big',
        'drag',
        'task-list',
        'task-list:big',
        'timeaxis',
      ];
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
  // Dependency lines leave the predecessor's side (end for FS/FF, start for SS/SF) and enter the successor's
  // side (start for FS/SS, end for FF/SF), at a height within each bar. Demos with dependencies must draw some.
  const chart = document.querySelector('.qz-gantt');
  const timelineBody = chart?.querySelector('.qz-timeline__body');
  if (chart && timelineBody) {
    const origin = timelineBody.getBoundingClientRect();
    const timelineRows = [...chart.querySelectorAll('.qz-timeline__row')];
    const barOf = (id) => timelineRows.find((row) => row.dataset.key.slice(2) === id)?.querySelector('.qz-bar');
    const point = (bar, side) => {
      const rect = bar.getBoundingClientRect();
      const milestone = bar.classList.contains('qz-bar--milestone');
      const center = rect.left + rect.width / 2;
      const x = milestone ? center + (side === 'start' ? -7 : 7) : side === 'start' ? rect.left : rect.right;
      return { x: x - origin.left, top: rect.top - origin.top, bottom: rect.bottom - origin.top };
    };
    const meets = (x, y, target) =>
      Math.abs(x - target.x) <= 1 && y >= target.top - 1 && y <= target.bottom + 1;
    const paths = [...chart.querySelectorAll('.qz-dependency')];
    let checked = 0;
    for (const path of paths) {
      const numbers = path.getAttribute('d').match(/-?[0-9.]+/g).map(Number);
      const commands = path.getAttribute('d').match(/[MHV]/g);
      let x = numbers[0];
      let y = numbers[1];
      commands.slice(1).forEach((command, i) => {
        if (command === 'H') x = numbers[i + 2];
        else y = numbers[i + 2];
      });
      const fromBar = barOf(path.dataset.from);
      const toBar = barOf(path.dataset.to);
      if (!fromBar || !toBar) continue; // an end outside the rendered rows
      const type = path.dataset.type;
      const from = point(fromBar, type === 'FS' || type === 'FF' ? 'end' : 'start');
      const to = point(toBar, type === 'FS' || type === 'SS' ? 'start' : 'end');
      checked++;
      if (!meets(numbers[0], numbers[1], from) || !meets(x, y, to)) {
        problems.push('dependency ' + path.dataset.from + ' → ' + path.dataset.to + ' (' + type + ') does not meet its bars');
        break;
      }
    }
    const withDependencies = ['#bars', '#scheduling', '#dependencies', '#task-list'];
    if (withDependencies.includes(location.hash) && paths.length > 0 && checked === 0) {
      problems.push('no dependency line could be checked');
    }
    if (['#bars', '#scheduling', '#dependencies'].includes(location.hash) && paths.length === 0) {
      problems.push('the demo draws no dependency lines');
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

// Scrolls so the bar of the task with this row key starts 40 px into the visible timeline (clear of the
// auto-scroll zones at the edges), and waits for it to settle.
async function reveal(evaluate, key) {
  await evaluate(`(() => {
    const bar = document.querySelector('.qz-timeline__row[data-key="${key}"] .qz-bar');
    const list = document.querySelector('.qz-list__body');
    const scroller = document.querySelector('.qz-gantt__scroller');
    if (bar && list) scroller.scrollLeft += bar.getBoundingClientRect().left - list.getBoundingClientRect().right - 40;
  })()`);
  await sleep(400);
}

// Dragging with a real mouse (Chrome turns it into pointer events): in the drag demo, move the manually
// scheduled "Vendor" bar (Wednesday 7 Oct 08:00) two days on. Its start must become Friday 9 Oct (snapped to
// the day), and the bar must sit on a day boundary.
async function dragChecks(send, demo) {
  if (demo !== 'drag') return [];
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
  const measure = `(() => {
    const bar = document.querySelector('.qz-timeline__row[data-key="s:vendor"] .qz-bar');
    const body = document.querySelector('.qz-timeline__body');
    const cell = document.querySelector('.qz-header__row:last-child .qz-header__cell');
    if (!bar || !body || !cell) return null;
    const rect = bar.getBoundingClientRect();
    const origin = body.getBoundingClientRect().left; // moves with scrolling
    return {
      x: rect.left + Math.min(10, rect.width / 2),
      y: rect.top + rect.height / 2,
      left: rect.left - origin,
      tick: cell.getBoundingClientRect().width,
      ticks: [...document.querySelectorAll('.qz-header__row:last-child .qz-header__cell')].map((c) => c.getBoundingClientRect().left - origin),
      scroll: document.querySelector('.qz-gantt__scroller').scrollLeft,
      start: document.querySelector('.qz-grid__row[data-key="s:vendor"] .qz-grid__cell:nth-child(2)').textContent,
    };
  })()`;
  // Let earlier checks' scrolling (a touch fling keeps going for a while) come to rest first.
  await sleep(1000);
  await reveal(evaluate, 's:vendor');
  const before = await evaluate(measure);
  if (!before) return ['drag demo: no Vendor bar to drag'];
  const mouse = (type, x, y) =>
    send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x, y: before.y });
  await mouse('mousePressed', before.x, before.y);
  for (let step = 1; step <= 8; step++)
    await mouse('mouseMoved', before.x + (step * 2 * before.tick) / 8, before.y);
  // Mid-drag: the tooltip with the new dates is shown, inside the visible part of the timeline.
  const tooltip = await evaluate(`(() => {
    const tip = document.querySelector('.qz-drag-tooltip');
    if (!tip) return null;
    const rect = tip.getBoundingClientRect();
    const view = document.querySelector('.qz-gantt__scroller').getBoundingClientRect();
    return { text: tip.textContent, visible: rect.top >= view.top && rect.bottom <= view.bottom && rect.width > 0 };
  })()`);
  await mouse('mouseReleased', before.x + 2 * before.tick, before.y);
  await sleep(500);
  const after = await evaluate(measure);
  const problems = [];
  if (!after) return ['drag demo: the Vendor bar is gone after dragging'];
  if (!tooltip?.visible)
    problems.push(`drag demo: no visible tooltip while dragging (${JSON.stringify(tooltip)})`);
  if (before.start !== '7 Oct 2026' || after.start !== '9 Oct 2026') {
    problems.push(
      `drag demo: Vendor started on ${before.start} and on ${after.start} after the drag (expected 7 → 9 Oct)`,
    );
  }
  if (!after.ticks.some((tick) => Math.abs(tick - after.left) <= 1)) {
    problems.push('drag demo: the dropped bar is not on a day boundary');
  }
  problems.push(...(await moreDragChecks(evaluate, mouse)));
  return problems;
}

// The other drags, with a real mouse: progress, linking, drawing a bar, and auto-scrolling at the edge.
async function moreDragChecks(evaluate, mouse) {
  const problems = [];
  const box = (selector) =>
    evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    })()`);
  const gesture = async (from, to, hold = 0) => {
    await mouse('mouseMoved', from.x, from.y);
    await mouse('mousePressed', from.x, from.y);
    for (let step = 1; step <= 6; step++) {
      await mouse('mouseMoved', from.x + ((to.x - from.x) * step) / 6, from.y + ((to.y - from.y) * step) / 6);
    }
    if (hold) await sleep(hold);
    await mouse('mouseReleased', to.x, to.y);
    await sleep(400);
  };
  const bar = (key) => `.qz-timeline__row[data-key="${key}"] .qz-bar`;

  // Progress: drag Design's handle (at 0 %) a third of the way along.
  await reveal(evaluate, 's:design');
  const design = await box(bar('s:design'));
  if (design) {
    await gesture(
      { x: design.left + 1, y: design.bottom - 2 },
      { x: design.left + design.width / 3, y: design.bottom - 2 },
    );
    const progress = await box(`${bar('s:design')} .qz-bar__progress`);
    if (!progress || progress.width < design.width / 4)
      problems.push('drag demo: dragging the progress handle did nothing');
  } else problems.push('drag demo: no Design bar');

  // Link: from Design's end handle onto Vendor (close together, so both are in view even at 700 px).
  await reveal(evaluate, 's:design');
  const arrows = await evaluate(`document.querySelectorAll('.qz-dependencies .qz-dependency').length`);
  const from = await box(bar('s:design'));
  const onto = await box(bar('s:vendor'));
  if (from && onto) {
    await gesture(
      { x: from.right + 5, y: from.top + from.height / 2 },
      { x: onto.left + 3, y: onto.top + onto.height / 2 },
    );
    const now = await evaluate(`document.querySelectorAll('.qz-dependencies .qz-dependency').length`);
    if (now !== arrows + 1)
      problems.push(`drag demo: linking by dragging gave ${String(now - arrows)} new arrows instead of 1`);
  } else problems.push('drag demo: no Design or Vendor bar to link');

  // Create: draw a bar in the Idea row.
  await evaluate(`document.querySelector('.qz-gantt__scroller').scrollLeft = 0`);
  await sleep(300);
  const idea = await box('.qz-timeline__row[data-key="s:idea"]');
  const view = await box('.qz-gantt__scroller');
  const list = await box('.qz-list__body');
  if (idea && view && list) {
    const y = idea.top + idea.height / 2;
    await gesture({ x: list.right + 20, y }, { x: list.right + 90, y });
    if (!(await box(bar('s:idea')))) problems.push('drag demo: drawing in the Idea row gave no bar');
  }

  // Auto-scroll: hold a bar past the right edge; the chart scrolls on its own (if there is anything to scroll).
  await reveal(evaluate, 's:develop');
  const [before, max] = await evaluate(
    `(() => { const s = document.querySelector('.qz-gantt__scroller'); return [s.scrollLeft, s.scrollWidth - s.clientWidth]; })()`,
  );
  const develop = await box(bar('s:develop'));
  if (develop && view && before < max - 1) {
    const y = develop.top + develop.height / 2;
    await gesture({ x: develop.left + 4, y }, { x: view.right + 20, y }, 600);
    const after = await evaluate(`document.querySelector('.qz-gantt__scroller').scrollLeft`);
    if (!(after > before)) problems.push('drag demo: holding a bar past the edge did not scroll');
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
      problems.push(...(await dragChecks(send, id)));
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
