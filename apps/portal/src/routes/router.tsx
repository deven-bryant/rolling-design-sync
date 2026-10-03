import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { Layout } from './Layout';
import { FileLayout } from './FileLayout';
import {
  ActivityPage,
  AgentsPage,
  ConnectPage,
  FileActivityPage,
  FileClaimsPage,
  FileIndexPage,
  FileScopesPage,
  FilesPage,
  NodesPage,
  NotFoundPage,
  WorkPage,
} from './pages';
import { SignInPage } from './SignInPage';

export const BASENAME = '/ui';

/** The portal's screens (docs/ui-portal.md "Screens"); the gallery exists in dev builds only. */
export const routes: RouteObject[] = [
  { path: 'sign-in', element: <SignInPage /> },
  ...(import.meta.env.DEV
    ? [{ path: '_gallery', lazy: async () => ({ Component: (await import('./GalleryPage')).GalleryPage }) }]
    : []),
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/files" replace /> },
      { path: 'files', element: <FilesPage /> },
      { path: 'files/:fileKey', element: <FileIndexPage /> },
      {
        path: 'files/:fileKey',
        element: <FileLayout />,
        children: [
          { path: 'nodes', element: <NodesPage /> },
          { path: 'work', element: <WorkPage /> },
          { path: 'activity', element: <FileActivityPage /> },
          { path: 'claims', element: <FileClaimsPage /> },
          { path: 'scopes', element: <FileScopesPage /> },
        ],
      },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'agents', element: <AgentsPage /> },
      { path: 'connect', element: <ConnectPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes, { basename: BASENAME });
