import { useEffect } from 'react';
import { Icon } from './Icon';

/**
 * A simple help / "key concepts" overlay. Self-contained: it renders its own
 * backdrop and closes on Escape or backdrop click. The most important section
 * is how offline sync works, since unsynced changes live only on the device.
 */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    useEffect(() => {
        if (!open) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="modal-backdrop" onMouseDown={onClose}>
            <div
                className="modal help-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Help and key concepts"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="modal-head">
                    <h2 className="modal-title">Help &amp; key concepts</h2>
                    <button type="button" className="ghost small icon-btn" aria-label="Close" onClick={onClose}>
                        <Icon name="close" size={16} />
                    </button>
                </div>

                <div className="modal-body help-body">
                    <section className="help-section help-highlight">
                        <h3>
                            <Icon name="sync" size={17} />
                            How sync works <span className="help-tag">important</span>
                        </h3>
                        <p>
                            The app works offline. When you add, edit, move, or delete an item — or attach a photo —
                            while offline, the change is <strong>queued on this device</strong> (in your browser) and
                            applied to the cloud later.
                        </p>
                        <ul>
                            <li>
                                The <strong>sync pill</strong> at the top shows your status: a green
                                cloud while syncing, a red <Icon name="cloud-off" size={14} /> when offline, and a
                                count of how many changes are still waiting. Tap it to sync immediately.
                            </li>
                            <li>
                                Syncing also happens <strong>automatically</strong> when you reconnect and each time you
                                open the app while online.
                            </li>
                            <li>
                                Changes are replayed <strong>in the order you made them</strong>. If one fails, syncing
                                pauses and retries on the next attempt, so nothing is applied out of order.
                            </li>
                            <li>
                                Queued changes live <strong>only on the device where you made them</strong> until they
                                sync. They won’t appear on your other devices — and could be lost if you clear the
                                browser’s site data — so always sync before switching devices.
                            </li>
                            <li>Sync requires you to be online and signed in.</li>
                        </ul>
                    </section>

                    <section className="help-section">
                        <h3>
                            <Icon name="boxes" size={17} />
                            Containers &amp; items
                        </h3>
                        <p>
                            A <strong>container</strong> (a bin, box, or shelf) holds <strong>items</strong>. Each
                            container has its own QR code so you can find what’s inside in seconds.
                        </p>
                    </section>

                    <section className="help-section">
                        <h3>
                            <Icon name="scan" size={17} />
                            Scan &amp; QR codes
                        </h3>
                        <p>
                            Print a container’s QR code and stick it on the box. Use <strong>Scan</strong> to point your
                            camera at any container’s code and jump straight to its contents.
                        </p>
                    </section>

                    <section className="help-section">
                        <h3>
                            <Icon name="search" size={17} />
                            Search &amp; filters
                        </h3>
                        <p>
                            <strong>Search</strong> finds items by name or description across every container. Narrow
                            results with the filters for owner, location, and category, or tap a tag.
                        </p>
                    </section>

                    <section className="help-section">
                        <h3>
                            <Icon name="tag" size={17} />
                            Tags, owners, locations &amp; categories
                        </h3>
                        <p>
                            Manage your reusable lists on the <strong>Tags</strong> page. Owners, locations, and
                            categories become dropdowns when you add or edit containers and items, keeping everything
                            consistent.
                        </p>
                    </section>

                    <section className="help-section">
                        <h3>
                            <Icon name="sync" size={17} />
                            Reload vs. sync
                        </h3>
                        <p>
                            The circular <strong>reload</strong> button refreshes what’s shown from the cloud. It is
                            different from <em>sync</em>, which pushes your own queued changes up. Use reload to pull
                            the latest; the sync badge handles sending your edits.
                        </p>
                    </section>
                </div>

                <div className="modal-actions">
                    <button type="button" onClick={onClose}>
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}
