import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Icon } from '../Icon';
import type { AppUser, AuthInfo, Role } from '../types';

export default function AdminPage() {
    const navigate = useNavigate();
    const [me, setMe] = useState<AuthInfo | null>(null);
    const [users, setUsers] = useState<AppUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<Role>('member');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        (async () => {
            const auth = await api.getMe();
            if (!active) return;
            setMe(auth);
            if (!auth.isAdmin) {
                setLoading(false);
                return;
            }
            try {
                setUsers(await api.listUsers());
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : 'Failed to load users.');
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => {
            active = false;
        };
    }, []);

    async function invite(e: React.FormEvent) {
        e.preventDefault();
        const trimmed = email.trim();
        if (!trimmed) return;
        setBusy(true);
        setError(null);
        try {
            const created = await api.inviteUser(trimmed, role);
            setUsers((prev) => [...prev, created].sort(sortUsers));
            setEmail('');
            setRole('member');
        } catch (e) {
            setError(
                e instanceof ApiError && e.status === 409
                    ? 'That email is already invited.'
                    : e instanceof Error
                      ? e.message
                      : 'Failed to send invite.',
            );
        } finally {
            setBusy(false);
        }
    }

    async function changeRole(user: AppUser, next: Role) {
        setError(null);
        try {
            const updated = await api.setUserRole(user.id, next);
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)).sort(sortUsers));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to change role.');
        }
    }

    async function remove(user: AppUser) {
        if (!confirm(`Remove access for ${user.email}?`)) return;
        setError(null);
        try {
            await api.removeUser(user.id);
            setUsers((prev) => prev.filter((u) => u.id !== user.id));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to remove user.');
        }
    }

    if (loading) return <div className="center">Loading…</div>;

    if (me && !me.isAdmin) {
        return (
            <div>
                <h1>Members</h1>
                <div className="center">
                    You don’t have access to manage members.
                    <div style={{ marginTop: 14 }}>
                        <button className="ghost" onClick={() => navigate('/')}>
                            Back to search
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <h1>Members</h1>
            <p className="muted">
                Invite household members by their Microsoft email. They get access the first time they
                sign in with that account.
            </p>

            <form onSubmit={invite} className="card" style={{ marginTop: 14 }}>
                <label htmlFor="invite-email">Email to invite</label>
                <input
                    id="invite-email"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
                <label htmlFor="invite-role">Role</label>
                <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                </select>
                <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
                    <button type="submit" disabled={busy || !email.trim()}>
                        <Icon name="plus" size={16} /> Invite
                    </button>
                </div>
            </form>

            {error && (
                <div className="card" style={{ marginTop: 12, borderColor: 'var(--danger)' }}>
                    <span className="muted">{error}</span>
                </div>
            )}

            <h2>People with access</h2>
            <div className="stack">
                {users.map((u) => {
                    const isSelf = me?.email?.toLowerCase() === u.email.toLowerCase();
                    return (
                        <div key={u.id} className="card">
                            <div className="spread">
                                <div>
                                    <strong>{u.displayName || u.email}</strong>
                                    {u.displayName && <div className="muted">{u.email}</div>}
                                    <div className="muted">
                                        {u.lastLoginAt
                                            ? `Last sign-in ${new Date(u.lastLoginAt).toLocaleDateString()}`
                                            : 'Hasn’t signed in yet'}
                                        {isSelf ? ' · you' : ''}
                                    </div>
                                </div>
                                <span className={`pill${u.role === 'admin' ? ' selectable' : ''}`}>{u.role}</span>
                            </div>
                            <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                                {u.role === 'member' ? (
                                    <button className="ghost small" onClick={() => changeRole(u, 'admin')}>
                                        Make admin
                                    </button>
                                ) : (
                                    <button
                                        className="ghost small"
                                        disabled={isSelf}
                                        onClick={() => changeRole(u, 'member')}
                                    >
                                        Make member
                                    </button>
                                )}
                                <button className="danger small" disabled={isSelf} onClick={() => remove(u)}>
                                    <Icon name="trash" size={16} /> Remove
                                </button>
                            </div>
                        </div>
                    );
                })}
                {users.length === 0 && <div className="center">No members yet.</div>}
            </div>
        </div>
    );
}

function sortUsers(a: AppUser, b: AppUser): number {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return a.email.localeCompare(b.email);
}
