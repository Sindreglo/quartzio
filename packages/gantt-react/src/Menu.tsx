import type { GanttController, MenuItem, MenuState } from '@quartzio/gantt';
import { type ReactElement, type RefObject, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { focusBackWhenGone } from './events';

const MARGIN = 4;

/** Keeps an element inside the window (it's fixed, in the top layer). */
function keepInWindow(element: HTMLElement, left: number, top: number): void {
  const size = element.getBoundingClientRect();
  element.style.left = `${String(Math.max(MARGIN, Math.min(left, innerWidth - size.width - MARGIN)))}px`;
  element.style.top = `${String(Math.max(MARGIN, Math.min(top, innerHeight - size.height - MARGIN)))}px`;
}

/** A submenu hangs to the right of its item, or to the left when there's no room. */
function Submenu({ children }: { children: ReactElement }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current?.firstElementChild;
    if (menu && menu.getBoundingClientRect().right > innerWidth - MARGIN) menu.classList.add('qz-menu--left');
  }, []);
  return (
    <div ref={ref} className="qz-menu__sub">
      {children}
    </div>
  );
}

/**
 * The open context menu. The engine decides what's in it, what's highlighted and what the keys do; this shows it
 * where the engine says (in a popover, so the chart doesn't clip it) and passes the pointer and keys on.
 */
export function ContextMenu({
  gantt,
  menu,
  rootRef,
  onDone,
}: {
  gantt: GanttController;
  menu: MenuState;
  rootRef: RefObject<HTMLDivElement | null>;
  /** Focus back to the chart when the menu goes. */
  onDone: () => void;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const prefix = `qz-menu${useId().replace(/[^\w-]/g, '')}`;

  useLayoutEffect(() => {
    const element = ref.current;
    const box = rootRef.current?.getBoundingClientRect();
    if (!element || !box) return;
    if (typeof element.showPopover === 'function' && !element.matches(':popover-open')) element.showPopover();
    keepInWindow(element, box.left + menu.x, box.top + menu.y);
  }, [menu.x, menu.y, rootRef]);

  useLayoutEffect(() => {
    const element = ref.current;
    element?.focus({ preventScroll: true });
    return () => {
      focusBackWhenGone(element, onDone);
    };
  }, [onDone]);

  // A press anywhere else, the window losing focus or being resized closes it.
  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) gantt.closeMenu();
    };
    const close = () => {
      gantt.closeMenu();
    };
    document.addEventListener('pointerdown', onPress, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [gantt]);

  const itemId = (item: MenuItem) => `${prefix}-${item.id.replace(/[^\w-]/g, '_')}`;
  const list = (items: readonly MenuItem[], submenu: boolean) => (
    <div className={submenu ? 'qz-menu qz-menu--sub' : 'qz-menu__list'} role={submenu ? 'menu' : undefined}>
      {items.map((item) => (
        <div key={item.id} role="none">
          {item.separator && <div className="qz-menu__separator" role="separator" />}
          <div
            id={itemId(item)}
            className={item.id === menu.active ? 'qz-menu__item qz-menu__item--active' : 'qz-menu__item'}
            role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={item.checked}
            aria-disabled={item.disabled === true ? true : undefined}
            aria-haspopup={item.items ? 'menu' : undefined}
            aria-expanded={item.items ? menu.submenu === item.id : undefined}
            onPointerEnter={() => {
              gantt.menuHover(item.id);
            }}
            onClick={() => {
              if (item.items) gantt.menuHover(item.id);
              else gantt.menuAction(item.id);
            }}
          >
            <span className="qz-menu__check" aria-hidden="true">
              {item.checked === true ? '✓' : ''}
            </span>
            <span className="qz-menu__label">{item.label}</span>
            {item.items && (
              <span className="qz-menu__arrow" aria-hidden="true">
                ▸
              </span>
            )}
          </div>
          {item.items && menu.submenu === item.id && <Submenu>{list(item.items, true)}</Submenu>}
        </div>
      ))}
    </div>
  );
  const active =
    menu.active === null ? undefined : [...menu.items, ...menu.items.flatMap((item) => item.items ?? [])];
  const activeItem = active?.find((item) => item.id === menu.active);

  return (
    <div
      ref={ref}
      className="qz-menu"
      popover="manual"
      role="menu"
      tabIndex={-1}
      aria-activedescendant={activeItem ? itemId(activeItem) : undefined}
      onKeyDown={(event) => {
        event.stopPropagation(); // the menu's keys, not the chart's
        const { key, shiftKey: shift, ctrlKey: ctrl, metaKey: meta, altKey: alt } = event;
        if (gantt.menuKeyDown({ key, shift, ctrl, meta, alt })) event.preventDefault();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      {list(menu.items, false)}
    </div>
  );
}
