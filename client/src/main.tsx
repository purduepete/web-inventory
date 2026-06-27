import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import App from './App';
import HomePage from './pages/HomePage';
import ContainersPage from './pages/ContainersPage';
import NewContainerPage from './pages/NewContainerPage';
import ContainerPage from './pages/ContainerPage';
import ScanPage from './pages/ScanPage';
import AdminPage from './pages/AdminPage';
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
            { path: 'admin', element: <AdminPage /> },
        ],
    },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <RouterProvider router={router} />
    </React.StrictMode>,
);
