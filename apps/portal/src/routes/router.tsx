import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { Layout } from './Layout';
import { FileLayout } from './FileLayout';
import { ActivityPage, ClaimsPage, ConnectPage, FilesPage, NodesPage, NotFoundPage, Redirect, WorkPage } from './pages';
import { SignInPage } from './SignInPage';
import { filePath } from './urlState';

export const BASENAME = '/ui';

const toNodes = ({ fileKey = '' }: { fileKey?: string }) => filePath(fileKey, 'nodes');

/** The portal's screens (docs/ui-portal.md "Screens"); the gallery exists in dev builds only. */
export const routes: RouteObject[] = [
  { path: 'sign-in', element: <SignInPage /> },
  ...(import.meta.env.DEV
    ? [
        {
          path: '_gallery',
          lazy: async () => ({
            Component: (await import('./GalleryPage')).GalleryPage,
          }),
        },
      ]
    : []),
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/files" replace /> },
      { path: 'files', element: <FilesPage /> },
      { path: 'files/:fileKey', element: <Redirect to={toNodes} /> },
      { path: 'files/:fileKey/scopes', element: <Redirect to={toNodes} /> },
      { path: 'files/:fileKey/claims', element: <Redirect to="/claims" /> },
      { path: 'files/:fileKey/activity', element: <Redirect to="/activity" /> },
      {
        path: 'files/:fileKey',
        element: <FileLayout />,
        children: [
          { path: 'nodes', element: <NodesPage /> },
          { path: 'work', element: <WorkPage /> },
        ],
      },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'claims', element: <ClaimsPage /> },
      { path: 'agents', element: <Redirect to="/claims" /> },
      { path: 'connect', element: <ConnectPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes, { basename: BASENAME });
