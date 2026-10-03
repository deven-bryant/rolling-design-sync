import type { ReactNode } from 'react';
import { RouterProvider } from 'react-aria-components';
import { useHref, useNavigate } from 'react-router';

export const REPO_URL = 'https://github.com/deven-bryant/rolling-design-sync';
export const DOCS_URL = `${REPO_URL}/tree/main/docs`;

const API_PATH = /^\/(v3|health)(\/|\?|$)/;
const isInternal = (href: string) => href.startsWith('/') && !href.startsWith('//') && !API_PATH.test(href);

function useRouteHref(href: string): string {
  const internal = useHref(isInternal(href) ? href : '/');
  return isInternal(href) ? internal : href;
}

/** Lets every React Aria link (`href` on Button, Tabs, SidebarNav, Breadcrumbs) navigate inside the router. */
export function RouteLinks({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <RouterProvider
      navigate={href => (isInternal(href) ? void navigate(href) : window.location.assign(href))}
      useHref={useRouteHref}
    >
      {children}
    </RouterProvider>
  );
}
