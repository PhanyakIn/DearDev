import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchOrder, downloadUrl } from "../lib/checkout";
import "../css/Success.css";

// Landing page for the download button inside the order email.
//
// This page exists for one reason: /api/download consumes quota on every
// request, and email providers/security tools prefetch every GET link they
// see. If the email pointed straight at /api/download, scanners would burn the
// buyer's quota before they ever click. Here the download only happens when a
// real browser user presses the button.

function Download() {
  const [params] = useSearchParams();
  const orderId = params.get("orderId") || "";
  const token = params.get("token") || "";
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | missing | error

  const load = useCallback(() => {
    if (!orderId || !token) {
      setStatus("missing");
      return;
    }
    fetchOrder(orderId, token)
      .then((data) => {
        setOrder(data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [orderId, token]);

  useEffect(() => {
    load();
  }, [load]);

  if (status === "loading") return <div className="Success"><p>Loading…</p></div>;
  if (status === "missing") {
    return (
      <div className="Success">
        <p>This download link is incomplete.</p>
        <p><Link to="/recover">Recover your last order</Link> or contact the shop.</p>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="Success">
        <p>This download link is invalid or has expired.</p>
        <p><Link to="/recover">Recover your last order</Link> or contact the shop.</p>
      </div>
    );
  }

  const paid = order.status === "paid";
  const outOfQuota = order.remaining <= 0;

  return (
    <div className="Success">
      <h1>Your file is ready 📦</h1>
      {order.productName && <p className="success-product">{order.productName}</p>}

      <div className="success-card">
        {!paid ? (
          <>
            <p>
              Status: <strong>{order.status}</strong>
            </p>
            <p className="success-hint">
              This order is not paid yet, so the file is not available. If you have
              already paid, please contact the shop with your slip.
            </p>
          </>
        ) : outOfQuota ? (
          <>
            <span className="success-download disabled">Download limit reached</span>
            <p className="success-hint">
              All {order.downloadLimit} downloads for this order have been used.
            </p>
          </>
        ) : (
          <>
            <p className="success-download-note">
              <strong>{order.remaining}</strong> of {order.downloadLimit} downloads remaining
            </p>
            <a
              className="success-download"
              href={downloadUrl(orderId, token)}
              target="_blank"
              rel="noreferrer"
              onClick={() => setTimeout(load, 1500)}
            >
              Download the file
            </a>
            <p className="success-hint">
              The file downloads in a new tab. You can return here to download again
              while you still have downloads left.
            </p>
          </>
        )}

        <Link className="success-copy-link" to={`/success?orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`}>
          Open the full order page (license key)
        </Link>
      </div>

      <p className="success-back">
        <Link to="/catalog">← Back to store</Link>
      </p>
    </div>
  );
}

export default Download;
