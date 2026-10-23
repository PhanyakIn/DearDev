import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchOrder, downloadUrl, readStoredCharge } from "../lib/checkout";
import "../css/Success.css";

function Success() {
  const [params] = useSearchParams();
  const orderId = params.get("orderId") || "";
  const token = params.get("token") || "";
  const emailFailed = params.get("email") === "0";
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | missing | error
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

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

  const copyKey = async () => {
    if (!order?.licenseKey) return;
    try {
      await navigator.clipboard.writeText(order.licenseKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (status === "loading") return <div className="Success"><p>Loading…</p></div>;
  if (status === "missing") {
    return (
      <div className="Success">
        <p>This order link is incomplete.</p>
        <p><Link to="/recover">Recover your last order</Link> or contact the shop.</p>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="Success">
        <p>This order link is invalid or has expired.</p>
        <p><Link to="/recover">Recover your last order</Link> or contact the shop.</p>
      </div>
    );
  }

  const paid = order.status === "paid";
  // The buyer may have paid but closed the site before uploading the slip.
  // If the charge is still resumable, offer a direct way back to it.
  const resumeCharge =
    !paid && order.productId ? readStoredCharge(order.productId).charge : null;

  return (
    <div className="Success">
      <h1>{paid ? "Payment successful 🎉" : "Order status"}</h1>
      {order.productName && <p className="success-product">{order.productName}</p>}

      {!paid ? (
        <div className="success-card">
          <p>
            Status: <strong>{order.status}</strong>
          </p>
          <p>If you have already paid but have not received your product, please contact the shop with your slip.</p>
          {resumeCharge && (
            <>
              <Link
                className="success-download"
                to={`/checkout/${encodeURIComponent(order.productId)}`}
              >
                Back to payment / Upload slip
              </Link>
              <p className="success-hint">
                Your QR may have expired, but you can still upload your slip for a while after paying.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="success-card">
          <p className="success-label">License key</p>
          <div className="success-key">
            <code>{order.licenseKey}</code>
            <button type="button" onClick={copyKey}>{copiedKey ? "Copied" : "Copy"}</button>
          </div>

          <p className="success-download-note">
            <strong>{order.remaining}</strong> of {order.downloadLimit} downloads remaining
          </p>
          {order.remaining > 0 ? (
            <a
              className="success-download"
              href={downloadUrl(orderId, token)}
              target="_blank"
              rel="noreferrer"
              onClick={() => setTimeout(load, 1500)}
            >
              Download product
            </a>
          ) : (
            <span className="success-download disabled">Download limit reached</span>
          )}

          <p className="success-hint">
            {emailFailed
              ? "Email delivery is not enabled. Save or bookmark this page — this link is the only way to download."
              : "Save or bookmark this page. You need this link to download the product again."}
          </p>
          <p className="success-hint">
            Didn&apos;t receive the email? Check your Junk/Spam folder — this page can always be used to download instead.
          </p>
          <button type="button" className="success-copy-link" onClick={copyLink}>
            {copiedLink ? "Link copied" : "Copy this order link"}
          </button>
        </div>
      )}

      <p className="success-back">
        <Link to="/catalog">← Back to store</Link>
      </p>
    </div>
  );
}

export default Success;
