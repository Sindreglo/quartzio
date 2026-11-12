import { type MouseEvent, useEffect, useState } from 'react';
import { type Demo, demos, SECTIONS, type Section } from './demos';

/**
 * Addresses: `/<section>` shows every demo of a section, one under the other, and `#<demo id>` scrolls to one.
 * `?only=<demo id>` shows a single demo on its own (the layout checks use it). An old `/#<demo id>` link goes to
 * the demo's section.
 */
export interface Route {
  section: Section;
  /** The demo the hash points at, if any. */
  target: Demo | undefined;
  /** `?only=`: just this demo. */
  only: Demo | undefined;
}

const byId = (id: string | null | undefined) => (id ? demos.find((demo) => demo.id === id) : undefined);

function current(): Route {
  const { pathname, hash, search } = window.location;
  const target = byId(decodeURIComponent(hash.slice(1)));
  const only = byId(new URLSearchParams(search).get('only'));
  const sectionId = pathname.split('/').find(Boolean);
  const section =
    SECTIONS.find((each) => each.id === sectionId) ??
    SECTIONS.find((each) => each.id === (only ?? target)?.section) ??
    SECTIONS[0];
  // Show the canonical address (keeping the query, e.g. ?theme=dark, and the hash).
  const canonical = `/${section.id}`;
  if (pathname !== canonical) window.history.replaceState(null, '', canonical + search + hash);
  return { section, target, only };
}

const listeners = new Set<() => void>();

/** Goes to an address without reloading, with a history entry (back and forward work). */
export function navigate(url: URL): void {
  const next = url.pathname + url.search + url.hash;
  if (next === window.location.pathname + window.location.search + window.location.hash) return;
  const samePage = url.pathname === window.location.pathname;
  window.history.pushState(null, '', next);
  if (!samePage && !url.hash) window.scrollTo({ top: 0 });
  for (const listener of listeners) listener();
}

/** The route the address shows, following navigation and back/forward. */
export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const update = () => {
      setRoute(current());
    };
    listeners.add(update);
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
    };
  }, []);
  return route;
}

/** For `<a onClick>`: navigates in place, but leaves Ctrl/Cmd/Shift/middle clicks (new tab) to the browser. */
export function onLinkClick(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const url = new URL(event.currentTarget.href);
  // The query (the theme) stays with the page.
  navigate(new URL(url.pathname + window.location.search + url.hash, window.location.origin));
}
