import { useEffect, useState } from 'react';
import type { RemoteStatus } from '../../shared/types';

const defaultStatus: RemoteStatus = {
  enabled: false,
  running: false,
  port: 17321,
  bindHost: '0.0.0.0',
  urls: [],
  pairingUrl: null,
  pairingCode: null,
  pairingQrDataUrl: null,
  clientCount: 0,
};

export function RemoteControl() {
  const [status, setStatus] = useState<RemoteStatus>(defaultStatus);
  const [port, setPort] = useState(17321);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.api.remote.getStatus().then((s) => {
      setStatus(s);
      setPort(s.port);
    });
    const off = window.api.remote.onStatusChanged((s) => {
      setStatus(s);
      setPort(s.port);
    });
    return off;
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await window.api.remote.enable({ port, bindHost: '0.0.0.0' });
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable remote control');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await window.api.remote.disable();
      setStatus(next);
    } finally {
      setBusy(false);
    }
  };

  const primaryUrl = status.urls.find((url) => !url.includes('localhost')) ?? status.urls[0];

  return (
    <section className="remote-panel">
      <div className="remote-head">
        <span>Remote Control</span>
        <span className={`remote-dot ${status.running ? 'on' : ''}`} />
      </div>
      {status.running ? (
        <>
          <div className="remote-meta">
            {status.clientCount} client{status.clientCount === 1 ? '' : 's'} connected
          </div>
          {status.pairingQrDataUrl && (
            <img className="remote-qr" src={status.pairingQrDataUrl} alt="Remote pairing QR code" />
          )}
          {status.pairingCode && (
            <div className="remote-code" title="Pairing code">
              {status.pairingCode}
            </div>
          )}
          {primaryUrl && (
            <button
              className="remote-url"
              title={primaryUrl}
              onClick={() => void navigator.clipboard.writeText(primaryUrl)}
            >
              Copy URL
            </button>
          )}
          <button className="remote-disable" disabled={busy} onClick={disable}>
            Disable
          </button>
        </>
      ) : (
        <>
          <div className="remote-meta">Off. Enable only on a network you trust.</div>
          <label className="remote-port">
            <span>Port</span>
            <input
              value={port}
              inputMode="numeric"
              onChange={(e) => setPort(Number(e.target.value))}
              onBlur={() => setPort((p) => Math.max(1024, Math.min(65535, Math.round(p || 17321))))}
            />
          </label>
          <button disabled={busy} onClick={enable}>
            Enable
          </button>
          {(error || status.error) && <div className="remote-error">{error ?? status.error}</div>}
        </>
      )}
    </section>
  );
}
