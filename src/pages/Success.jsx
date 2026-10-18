import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchOrder, downloadUrl } from "../lib/checkout";
import "../css/Success.css";

function Success() {
  const [params] = useSearchParams();
  const orderId = params.get("orderId") || "";
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | missing | error
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    if (!orderId) {
      setStatus("missing");
      return;
    }
    fetchOrder(orderId)
      .then((data) => {
        setOrder(data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const copyKey = async () => {
    if (!order?.licenseKey) return;
    try {
      await navigator.clipboard.writeText(order.licenseKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (status === "loading") return <div className="Success"><p>Loading…</p></div>;
  if (status === "missing") return <div className="Success"><p>Order not found</p><Link to="/catalog">Back to store</Link></div>;
  if (status === "error") return <div className="Success"><p>Could not load order details</p><Link to="/catalog">Back to store</Link></div>;

  const paid = order.status === "paid";

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
        </div>
      ) : (
        <div className="success-card">
          <p className="success-label">License key</p>
          <div className="success-key">
            <code>{order.licenseKey}</code>
            <button type="button" onClick={copyKey}>{copied ? "Copied" : "Copy"}</button>
          </div>

          <p className="success-download-note">
            <strong>{order.remaining}</strong> of {order.downloadLimit} downloads remaining
          </p>
          {order.remaining > 0 ? (
            <a
              className="success-download"
              href={downloadUrl(orderId)}
              target="_blank"
              rel="noreferrer"
              onClick={() => setTimeout(load, 1500)}
            >
              Download product
            </a>
          ) : (
            <span className="success-download disabled">Download limit reached</span>
          )}
          <p className="success-hint">This link was also sent to your email.</p>
        </div>
      )}

      <p className="success-back">
        <Link to="/catalog">← Back to store</Link>
      </p>
    </div>
  );
}

export default Success;
