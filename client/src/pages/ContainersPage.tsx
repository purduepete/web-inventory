import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { replaceCachedContainers, db, pendingContainerIds, suggestionContainerIds } from '../db';
import { Icon } from '../Icon';
import { Spinner } from '../Spinner';
import type { Container } from '../types';

const NO_OWNER = 'Unassigned';
// Per-device record of which owner groups are expanded. Absent / falsy = collapsed.
const GROUPS_KEY = 'containerGroupsOpen';

export default function ContainersPage() {
    const [containers, setContainers] = useState<Container[]>([]);
    const [loading, setLoading] = useState(true);
    const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
    const [reviewIds, setReviewIds] = useState<Set<string>>(new Set());
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
        try {
            return JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}');
        } catch {
            return {};
        }
    });

    useEffect(() => {
        let active = true;
        api.listContainers()
            .then((c) => {
                if (!active) return;
                setContainers(c);
                void replaceCachedContainers(c);
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

    useEffect(() => {
        const refresh = () => {
            void pendingContainerIds().then(setPendingIds);
            void suggestionContainerIds().then(setReviewIds);
        };
        refresh();
        window.addEventListener('pending-changed', refresh);
        window.addEventListener('suggestions-ready', refresh);
        return () => {
            window.removeEventListener('pending-changed', refresh);
            window.removeEventListener('suggestions-ready', refresh);
        };
    }, []);

    // Group containers by owner; named owners first (alphabetical), Unassigned last.
    const groups = useMemo(() => {
        const map = new Map<string, Container[]>();
        for (const c of containers) {
            const key = c.owner?.trim() || NO_OWNER;
            (map.get(key) ?? map.set(key, []).get(key)!).push(c);
        }
        for (const list of map.values()) list.sort((a, b) => a.number - b.number);
        return [...map.entries()].sort(([a], [b]) => {
            if (a === NO_OWNER) return 1;
            if (b === NO_OWNER) return -1;
            return a.localeCompare(b);
        });
    }, [containers]);

    function toggleGroup(owner: string) {
        setOpenGroups((prev) => {
            const next = { ...prev, [owner]: !prev[owner] };
            localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
            return next;
        });
    }

    if (loading) return <Spinner />;

    return (
        <div>
            <div className="spread">
                <h1>Containers</h1>
                <Link to="/containers/new">
                    <button className="small icon-btn" title="New container" aria-label="New container">
                        <Icon name="plus" size={16} />
                    </button>
                </Link>
            </div>
            {containers.length === 0 ? (
                <div className="center">No containers yet. Create your first one.</div>
            ) : (
                groups.map(([owner, list]) => {
                    const open = !!openGroups[owner];
                    return (
                        <section key={owner} className="owner-group">
                            <button
                                type="button"
                                className="group-toggle"
                                aria-expanded={open}
                                onClick={() => toggleGroup(owner)}
                            >
                                <Icon name="chevron" size={18} className={`group-chevron${open ? ' open' : ''}`} />
                                <Icon name="user" size={16} />
                                <span className="group-name">{owner}</span>
                                <span className="muted group-count">{list.length}</span>
                            </button>
                            {open && (
                                <div className="stack card-grid">
                                    {list.map((c) => (
                                        <Link key={c.id} to={`/containers/${c.id}`} className="card container-card">
                                            <span className="owner-col">{c.owner?.trim() || NO_OWNER}</span>
                                            <div className="card-main">
                                                <div className="spread">
                                                    <strong>
                                                        #{c.number} · {c.name}
                                                    </strong>
                                                    <span className="muted">{c.itemCount ?? 0} items</span>
                                                </div>
                                                {c.location && <div className="muted">{c.location}</div>}
                                                {pendingIds.has(c.id) && (
                                                    <span className="card-pill sync">
                                                        <Icon name="cloud" size={13} /> Pending sync
                                                    </span>
                                                )}
                                                {reviewIds.has(c.id) && (
                                                    <span className="card-pill review">
                                                        <Icon name="sparkles" size={13} /> Items to review
                                                    </span>
                                                )}
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </section>
                    );
                })
            )}
        </div>
    );
}
