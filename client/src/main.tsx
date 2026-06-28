import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import App from './App';
import HomePage from './pages/HomePage';
import ContainersPage from './pages/ContainersPage';
import NewContainerPage from './pages/NewContainerPage';
import ContainerPage from './pages/ContainerPage';
import ScanPage from './pages/ScanPage';
import ManagePage from './pages/ManagePage';
import { DialogProvider } from './Dialog';
import './pwa';
import './styles.css';

const router = createBrowserRouter([
    {
        path: '/',
        element: <App />,
        children: [
            { index: true, element: <HomePage /> },
            { path: 'containers', element: <ContainersPage /> },
            { path: 'containers/new', element: <NewContainerPage /> },
            { path: 'containers/:id', element: <ContainerPage /> },
            { path: 'c/:token', element: <ContainerPage byToken /> },
            { path: 'scan', element: <ScanPage /> },
            { path: 'manage', element: <ManagePage /> },
        ],
    },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <DialogProvider>
            <RouterProvider router={router} />
        </DialogProvider>
    </React.StrictMode>,
);
