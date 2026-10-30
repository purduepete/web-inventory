import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import App from './App';
import { Spinner } from './Spinner';
import { DialogProvider } from './Dialog';
import { Tooltip } from './Tooltip';
import './pwa';
import './styles.css';

// Route-level code splitting: pages (and the heavy html5-qrcode scanner) load on
// demand so the initial PWA shell stays small.
const HomePage = lazy(() => import('./pages/HomePage'));
const ContainersPage = lazy(() => import('./pages/ContainersPage'));
const NewContainerPage = lazy(() => import('./pages/NewContainerPage'));
const ContainerPage = lazy(() => import('./pages/ContainerPage'));
const ScanPage = lazy(() => import('./pages/ScanPage'));
const ManagePage = lazy(() => import('./pages/ManagePage'));

const page = (element: React.ReactNode) => (
    <Suspense fallback={<Spinner page label="Loading page" />}>{element}</Suspense>
);

const router = createBrowserRouter([
    {
        path: '/',
        element: <App />,
        children: [
            { index: true, element: page(<HomePage />) },
            { path: 'containers', element: page(<ContainersPage />) },
            { path: 'containers/new', element: page(<NewContainerPage />) },
            { path: 'containers/:id', element: page(<ContainerPage />) },
            { path: 'c/:token', element: page(<ContainerPage byToken />) },
            { path: 'scan', element: page(<ScanPage />) },
            { path: 'manage', element: page(<ManagePage />) },
        ],
    },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <DialogProvider>
            <RouterProvider router={router} />
            <Tooltip />
        </DialogProvider>
    </React.StrictMode>
);
