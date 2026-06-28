import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { cacheContainers, db } from '../db';
import { Icon } from '../Icon';
import { Spinner } from '../Spinner';
import type { Container } from '../types';

export default function ContainersPage() {
    const [containers, setContainers] = useState<Container[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        api.listContainers()
            .then((c) => {
                if (!active) return;
                setContainers(c);
                void cacheContainers(c);
            })
            .catch(async () => {
                // Offline fallback: show cached containers.
                const cached = await db.containers.orderBy('number').toArray();
                if (active) setContainers(cached);
            })
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, []);

    if (loading) return <Spinner />;

    return (
        <div>
            <div className="spread">
                <h1>Containers</h1>
                <Link to="/containers/new">
                    <button className="small">
                        <Icon name="plus" size={16} /> New
                    </button>
                </Link>
            </div>
            <div className="stack card-grid">
                {containers.map((c) => (
                    <Link key={c.id} to={`/containers/${c.id}`} className="card">
                        <div className="spread">
                            <strong>
                                #{c.number} · {c.name}
                            </strong>
                            <span className="muted">{c.itemCount ?? 0} items</span>
                        </div>
                        {c.location && <div className="muted">{c.location}</div>}
                    </Link>
                ))}
                {containers.length === 0 && <div className="center">No containers yet. Create your first one.</div>}
            </div>
        </div>
    );
}
